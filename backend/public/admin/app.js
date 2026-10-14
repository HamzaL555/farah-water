/* eslint-disable */
/**
 * Farah Su Şirkəti — web idarə paneli.
 *
 * No build step and no dependencies: this is plain ES2020 the browser runs
 * directly, deployed as static files. It talks to the same REST API the phone
 * app uses, so every number on screen comes from the same server-side,
 * authoritative calculations - nothing is recomputed in the browser.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------ config --
  var API =
    (window.FARAH_API_URL || 'https://farah-water.vercel.app/api/v1').replace(/\/$/, '');

  /** True when the signed-in account is the owner. Several screens gate on it. */
  var isAdmin = function () {
    return Boolean(state.user && state.user.role === 'ADMIN');
  };

  var LS_TOKEN = 'farah.accessToken';
  var LS_REFRESH = 'farah.refreshToken';
  var LS_USER = 'farah.user';

  var state = {
    token: null,
    refresh: null,
    user: null,
    route: 'dashboard',
  };

  // --------------------------------------------------------- utilities --
  // Both helpers fall back to `document`, so elements injected into #view are
  // reachable with the same selector used for the static markup.
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Money is rendered from the server's decimal string; never parsed to float. */
  function money(v) {
    if (v === null || v === undefined || v === '') return '0,00';
    var s = String(v);
    if (s.indexOf('.') === -1) s += '.00';
    var parts = s.split('.');
    var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    var frac = (parts[1] + '00').slice(0, 2);
    return whole + ',' + frac;
  }

  function withMoney(v) {
    return money(v) + ' AZN';
  }

  /**
   * Baku local time (UTC+4), which has no daylight saving.
   *
   * The offset is applied to the instant and the UTC parts are then read. The
   * server does the same thing for its own exports, and both have to agree: a
   * delivery recorded at 14:00 in Baku reads as 14:00 here whatever the viewer's
   * machine clock says, and 10:00 if the offset is forgotten.
   */
  var BAKU_OFFSET_MS = 4 * 3600 * 1000;

  function baku(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getTime() + BAKU_OFFSET_MS);
  }

  /** Dates render as DD.MM.YYYY in Baku local time (UTC+4). */
  function date(v) {
    if (!v) return '—';
    var d = baku(v);
    if (!d) return '—';
    return String(d.getUTCDate()).padStart(2, '0') + '.' +
           String(d.getUTCMonth() + 1).padStart(2, '0') + '.' +
           d.getUTCFullYear();
  }

  function dateTime(v) {
    if (!v) return '—';
    var d = baku(v);
    if (!d) return '—';
    return date(v) + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' +
           String(d.getUTCMinutes()).padStart(2, '0');
  }

  /** Today as YYYY-MM-DD, on the Baku calendar day (UTC+4). */
  function todayInput() {
    return new Date(Date.now() + BAKU_OFFSET_MS).toISOString().slice(0, 10);
  }

  function moneyInput(v) {
    if (v === null || v === undefined || v === '') return '0';
    return String(v);
  }

  function toast(msg, kind) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast ' + (kind === 'err' ? 'err' : 'ok');
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.hidden = true; }, 4200);
  }

  function idem(prefix) {
    return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
  }

  var STATUS = {
    PAID: { label: 'Ödənilib', cls: 'badge-paid' },
    PARTIAL: { label: 'Qismən', cls: 'badge-partial' },
    UNPAID: { label: 'Borc', cls: 'badge-unpaid' },
    CANCELLED: { label: 'Ləğv edilib', cls: 'badge-muted' },
  };

  var METHOD = { CASH: 'Nağd', CARD: 'Kart', TRANSFER: 'Köçürmə', OTHER: 'Digər' };
  var WATER = { FILTERED: 'Filtr', SPRING: 'Bulaq' };
  var WATER_FULL = { FILTERED: 'Filtr suyu', SPRING: 'Bulaq suyu' };

  var TX_LABEL = {
    INBOUND: 'Anbara qəbul',
    // The worker takes stock for themselves out of the warehouse; nobody
    // hands it to them. The old label described a step that no longer exists.
    ISSUE_TO_WORKER: 'Anbardan götürdü',
    OUT_DELIVERY: 'Çatdırıldı',
    RETURN_TO_STOCK: 'Anbara qaytarıldı',
    DAMAGE: 'Zədələnmiş',
    LOSS: 'İtmiş',
    CORRECTION: 'Düzəliş',
  };

  // ----------------------------------------------------------- network --
  function saveSession(data) {
    state.token = data.tokens.accessToken;
    state.refresh = data.tokens.refreshToken;
    state.user = data.user;
    localStorage.setItem(LS_TOKEN, state.token);
    localStorage.setItem(LS_REFRESH, state.refresh);
    localStorage.setItem(LS_USER, JSON.stringify(state.user));
  }

  function clearSession() {
    state.token = state.refresh = state.user = null;
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_REFRESH);
    localStorage.removeItem(LS_USER);
  }

  function loadSession() {
    var t = localStorage.getItem(LS_TOKEN);
    var r = localStorage.getItem(LS_REFRESH);
    var u = localStorage.getItem(LS_USER);
    if (!t || !r) return false;
    state.token = t;
    state.refresh = r;
    try { state.user = u ? JSON.parse(u) : null; } catch (e) { state.user = null; }
    return true;
  }

  /** One refresh attempt, then a hard sign-out. Never loops. */
  var refreshing = false;
  async function raw(method, path, body, token) {
    var res = await fetch(API + path, {
      method: method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    var text = await res.text();
    var json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    return { status: res.status, json: json, text: text, ok: res.ok };
  }

  async function api(method, path, body, isRetry) {
    var r = await raw(method, path, body, state.token);

    if (r.status === 401 && !isRetry && state.refresh) {
      if (!refreshing) {
        refreshing = true;
        try {
          var rr = await raw('POST', '/auth/refresh', { refreshToken: state.refresh });
          if (rr.ok && rr.json && rr.json.data) {
            saveSession(rr.json.data);
            refreshing = false;
            return api(method, path, body, true);
          }
        } catch (e) { /* fall through to sign-out */ }
        refreshing = false;
      }
      clearSession();
      showLogin();
      throw new Error('Sessiya bitdi. Yenidən daxil olun.');
    }

    if (!r.ok) {
      var msg = 'Xəta baş verdi.';
      if (r.json && r.json.error && r.json.error.message) msg = r.json.error.message;
      else if (r.text) msg = r.text.slice(0, 200);
      var err = new Error(msg);
      err.status = r.status;
      throw err;
    }

    // Recorded so the auto-refresh can tell "same data" from "new data"
    // without diffing the DOM.
    if (capture.length < 12) {
      try {
        capture.push(JSON.stringify(r.json && r.json.data !== undefined ? r.json.data : r.json));
      } catch (e) {
        capture.push('');
      }
    }

    return r.json ? r.json.data : null;
  }

  // -------------------------------------------------------------- auth --
  function showLogin() {
    $('#shell').hidden = true;
    $('#login').hidden = false;
    setDrawer(false);
    $('#login-password').value = '';
  }

  function showShell() {
    $('#login').hidden = true;
    $('#shell').hidden = false;
    setDrawer(false);
    var who = $('#who');
    who.innerHTML = '<strong>' + esc(state.user.fullName || '') + '</strong><br>' +
                    esc(state.user.username || '') + ' · ' +
                    (state.user.role === 'ADMIN' ? 'administrator' : 'işçi');
    // Must run on every successful auth, not just at boot: before login
    // state.user is null, so a build there would hide every admin-only page.
    buildNav();
  }

  $('#toggle-eye').addEventListener('click', function () {
    var p = $('#login-password');
    p.type = p.type === 'password' ? 'text' : 'password';
    this.textContent = p.type === 'password' ? '👁' : '🙈';
  });

  $('#login-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var err = $('#login-error');
    var btn = $('#login-submit');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Gözlənilir…';
    try {
      var data = await raw('POST', '/auth/login', {
        identifier: $('#login-identifier').value.trim(),
        password: $('#login-password').value,
      });
      if (!data.ok) throw new Error((data.json.error && data.json.error.message) || 'Giriş alınmadı.');
      saveSession(data.json.data);
      showShell();
      navigate(state.route || 'dashboard');
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Daxil ol';
    }
  });

  $('#logout').addEventListener('click', async function () {
    try { await api('POST', '/auth/logout'); } catch (e) { /* local sign-out regardless */ }
    clearSession();
    showLogin();
  });

  /**
   * Opens/closes the mobile drawer and keeps the scrim in step, so the drawer
   * can always be dismissed by tapping outside it.
   */
  function setDrawer(open) {
    $('.sidebar').classList.toggle('open', open);
    var scrim = $('#scrim');
    var isMobile = window.matchMedia('(max-width: 860px)').matches;
    scrim.hidden = !(open && isMobile);
  }

  $('#menu-toggle').addEventListener('click', function () {
    setDrawer(!$('.sidebar').classList.contains('open'));
  });

  $('#scrim').addEventListener('click', function () { setDrawer(false); });

  // -------------------------------------------------------------- nav ----
  /**
   * Every page the web panel can show.
   *
   * `admin: true` marks admin-only pages. Workers get their own set rather than
   * a filtered subset, so a worker sees the tools that actually apply to them:
   * record a delivery, record stock, see their own numbers, download their own
   * reports.
   */
  var PAGES = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard', roles: ['ADMIN'] },
    { id: 'workers',   icon: '👷', label: 'İşçilər',   roles: ['ADMIN'] },
    { id: 'stock',     icon: '🏭', label: 'Anbar',     roles: ['ADMIN'] },
    { id: 'mystock',   icon: '🧴', label: 'Bidonlarım', roles: ['WORKER'] },
    { id: 'customers', icon: '👥', label: 'Müştərilər', roles: ['ADMIN', 'WORKER'] },
    { id: 'deliveries',icon: '🚚', label: 'Çatdırılmalar', roles: ['ADMIN', 'WORKER'] },
    { id: 'debts',     icon: '⚠️', label: 'Borclar',   roles: ['ADMIN', 'WORKER'] },
    { id: 'revenue',   icon: '💰', label: 'Gəlirlər',  roles: ['ADMIN'] },
    { id: 'reports',   icon: '📈', label: 'Hesabat',   roles: ['ADMIN', 'WORKER'] },
    { id: 'audit',     icon: '🛡️', label: 'Audit',     roles: ['ADMIN'] },
    { id: 'profile',   icon: '👤', label: 'Profil',    roles: ['ADMIN', 'WORKER'] },
  ];

  function role() {
    return state.user && state.user.role === 'ADMIN' ? 'ADMIN' : 'WORKER';
  }

  function buildNav() {
    var r = role();
    $('#nav').innerHTML = PAGES.filter(function (p) { return p.roles.indexOf(r) >= 0; })
      .map(function (p) {
        return '<a href="#" data-page="' + p.id + '">' + p.icon + ' ' + esc(p.label) + '</a>';
      }).join('');
    $$('#nav a').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        setDrawer(false);
        navigate(a.dataset.page);
      });
    });
  }

  /** Guards direct navigation to a page the current role must not open. */
  function canOpen(page) {
    var def = PAGES.filter(function (p) { return p.id === page; })[0];
    if (!def) return false;
    return def.roles.indexOf(role()) >= 0;
  }

  function navigate(page) {
    if (!canOpen(page)) page = 'deliveries';
    state.route = page;
    if (location.hash.slice(1) !== page) location.hash = page;
    $$('#nav a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.page === page);
    });
    var def = PAGES.filter(function (p) { return p.id === page; })[0] || PAGES[0];
    $('#page-title').textContent = def.label;
    // Same DD.MM.YYYY HH:MM format as everywhere else, not a locale string.
    $('#topbar-meta').textContent = 'Farah Su Şirkəti · ' + dateTime(new Date().toISOString());
    var view = $('#view');
    view.innerHTML = '<div class="loader">Yüklənir…</div>';
    // A manual navigation must paint even if the data is unchanged, so the
    // stored signature is cleared here.
    lastSignature[page] = null;
    capture = [];
    render(page, view)
      .then(function () { lastSignature[page] = signatureOf(page); })
      .catch(function (e) {
        view.innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>';
      });
    scheduleRefresh();
  }

  window.addEventListener('hashchange', function () {
    var p = location.hash.slice(1);
    if (p && p !== state.route) navigate(p);
  });

  // ------------------------------------------------------------ modal ----
  function openModal(title, bodyHtml, footButtons) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    $('#modal-error').hidden = true;
    $('#modal-error').textContent = '';
    var foot = $('#modal-foot');
    foot.innerHTML = '';
    (footButtons || [{ label: 'Bağla', kind: 'outline' }]).forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn btn-' + (b.kind || 'outline');
      btn.textContent = b.label;
      btn.addEventListener('click', function () {
        if (b.onClick) {
          btn.disabled = true;
          $('#modal-error').hidden = true;
          // The handler is called INSIDE the chain, not as its argument.
          // `Promise.resolve(b.onClick(btn))` evaluates the call first, so a
          // synchronous `throw` from a validation check would escape before
          // .catch was ever attached - the error would vanish and the button
          // would stay disabled for good, looking like a frozen app.
          Promise.resolve()
            .then(function () { return b.onClick(btn); })
            .catch(function (e) {
              var box = $('#modal-error');
              box.textContent = e && e.message ? e.message : 'Xəta baş verdi.';
              box.hidden = false;
            })
            .then(function () {
              btn.disabled = false;
            });
        } else {
          closeModal();
        }
      });
      foot.appendChild(btn);
    });
    $('#modal').hidden = false;
  }

  function closeModal() { $('#modal').hidden = true; }
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', function (ev) {
    if (ev.target === this) closeModal();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !$('#modal').hidden) closeModal();
  });

  // ---------------------------------------------------------- helpers ----
  function card(label, value, cls, sub) {
    return '<div class="card ' + (cls || '') + '">' +
      '<div class="card-label">' + esc(label) + '</div>' +
      '<div class="card-value">' + esc(value) + '</div>' +
      (sub ? '<div class="card-sub">' + esc(sub) + '</div>' : '') +
      '</div>';
  }

  function statusBadge(s) {
    var st = STATUS[s] || { label: s || '—', cls: 'badge-muted' };
    return '<span class="badge ' + st.cls + '">' + esc(st.label) + '</span>';
  }

  function table(headers, rows, emptyText) {
    if (!rows.length) return '<div class="empty">' + esc(emptyText || 'Məlumat yoxdur') + '</div>';
    var thead = '<thead><tr>' + headers.map(function (h) {
      return '<th' + (h.num ? ' class="num"' : '') + '>' + esc(h.label) + '</th>';
    }).join('') + '</tr></thead>';
    var tbody = '<tbody>' + rows.map(function (r) {
      return '<tr>' + r.map(function (c, i) {
        var h = headers[i] || {};
        return '<td' + (h.num ? ' class="num mono"' : (h.cls ? ' class="' + h.cls + '"' : '')) + '>' + c + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody>';
    return '<div class="table-wrap"><table>' + thead + tbody + '</table></div>';
  }

  function panel(title, actions, bodyHtml, flush) {
    return '<div class="panel"><div class="panel-head"><h3>' + esc(title) + '</h3>' +
      '<div class="spacer"></div>' + (actions || '') + '</div>' +
      '<div class="panel-body' + (flush ? ' flush' : '') + '">' + bodyHtml + '</div></div>';
  }

  function moneyField(id, label, value, hint) {
    return '<label class="field"><span class="field-label">' + esc(label) + '</span>' +
      '<input id="' + id + '" type="text" inputmode="decimal" value="' + esc(moneyInput(value)) + '" />' +
      (hint ? '<span class="field-label" style="margin-top:4px">' + esc(hint) + '</span>' : '') +
      '</label>';
  }

  function textField(id, label, value, opts) {
    opts = opts || {};
    return '<label class="field"><span class="field-label">' + esc(label) + '</span>' +
      '<input id="' + id + '" type="' + (opts.type || 'text') + '" ' +
      (opts.multiline ? 'rows="3"' : '') + ' value="' + esc(value === null || value === undefined ? '' : value) + '" />' +
      '</label>';
  }

  // ==================================================== live refresh =====
  /**
   * The panel and the phone app share one database, so a delivery recorded on
   * the phone is already visible here. What this was NOT doing is refreshing an
   * open screen. This polls the active page and repaints only when the data
   * behind it actually changed.
   *
   * Guard rails, because a background refresh must never fight the user:
   *   - paused while the tab is hidden
   *   - skipped while a dialog is open or a field has focus
   *   - scroll position preserved across the repaint
   *   - a short "yeni məlumat" note rather than a silent jump
   */
  var AUTO_REFRESH_MS = 15000;

  /** Responses captured during a render, used to detect a change. */
  var capture = [];
  var lastSignature = {};

  function signatureOf(page) {
    return page + ':' + capture.map(function (c) { return c.length + ':' + c.slice(0, 24); }).join('|');
  }

  /** True when the user is mid-interaction and a refresh must wait. */
  function busy() {
    if (!$('#modal').hidden) return true;
    var el = document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  /**
   * Re-renders the page only when its data changed.
   * The probe render writes into a detached fragment, so nothing flickers unless
   * the answer is "different".
   */
  async function quietlyRefresh(page) {
    var view = $('#view');
    if (!view) return;

    capture = [];
    try {
      await render(page, document.createDocumentFragment());
    } catch (e) {
      return; // a transient network error must not blank the page
    }

    var sig = signatureOf(page);
    if (sig === lastSignature[page]) return;
    lastSignature[page] = sig;

    var y = window.scrollY;
    capture = [];
    try {
      await render(page, view);
    } catch (e) {
      return;
    }
    window.scrollTo(0, y);
    flashLive('yeni məlumat');
  }

  var refreshTimer = null;
  function scheduleRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (document.hidden || busy()) return;
      var page = state.route;
      if (!page || !canOpen(page)) return;
      quietlyRefresh(page);
    }, AUTO_REFRESH_MS);
  }

  var liveTimer = null;
  function flashLive(text) {
    var el = $('#live-tag');
    if (!el) return;
    el.textContent = '• ' + text;
    el.hidden = false;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { el.hidden = true; }, 4000);
  }

  document.addEventListener('visibilitychange', function () {
    // Returning to the tab: whatever happened elsewhere while it was hidden is
    // now worth fetching immediately rather than on the next tick.
    if (!document.hidden && !busy() && state.route) {
      lastSignature[state.route] = null;
      quietlyRefresh(state.route);
    }
  });

  // ============================================================ pages ====

  async function render(page, view) {
    if (page === 'dashboard') return pageDashboard(view);
    if (page === 'workers') return pageWorkers(view);
    if (page === 'stock') return pageStock(view);
    if (page === 'mystock') return pageMyStock(view);
    if (page === 'customers') return pageCustomers(view);
    if (page === 'deliveries') return pageDeliveries(view);
    if (page === 'debts') return pageDebts(view);
    if (page === 'revenue') return pageRevenue(view);
    if (page === 'reports') return pageReports(view);
    if (page === 'audit') return pageAudit(view);
    if (page === 'profile') return pageProfile(view);
    view.innerHTML = '<div class="alert alert-error">Səhifə tapılmadı.</div>';
  }

  // --------------------------------------------------------- my stock ---
  /** The worker's own bottles: the same actions the phone app offers. */
  async function pageMyStock(view) {
    var s = await api('GET', '/inventory/my-stock');
    var t = await api('GET', '/inventory/transactions?pageSize=25');
    // The warehouse total, so the worker can see what is there to take. Read
    // only - taking is a separate, explicit action.
    var w = await api('GET', '/inventory/summary');

    view.innerHTML =
      '<div class="cards">' +
        card('Əlimdəki bidonlar', String(s.quantity || 0), 'good') +
        card('Anbarda', String(w.warehouseQuantity || 0)) +
        card('Son yenilənmə', dateTime(s.updatedAt)) +
      '</div>' +
      '<div class="toolbar">' +
        '<button class="btn btn-primary" id="mb-in">+ Anbara qəbul (yeni gələn)</button>' +
        '<button class="btn btn-secondary" id="mb-take">→ Anbardan götür</button>' +
        '<button class="btn btn-outline" id="mb-back">↩ Anbara qaytar</button>' +
        '<button class="btn btn-outline" id="mb-wo">Zədələnmiş / itmiş</button>' +
      '</div>' +
      '<div class="alert alert-info">Yeni gələn bidonları sən qeyd edirsən və özün götürürsən. Admin yalnız baxır.</div>' +
      panel('İnventar tarixçəsi', '', table(
        [{ label: 'Əməliyyat' }, { label: 'Say' }, { label: 'Tarix' }, { label: 'Qeyd' }],
        (t.items || []).map(function (x) {
          return [
            esc(TX_LABEL[x.type] || x.type),
            '<span class="' + (x.signedCount > 0 ? 'badge badge-paid' : 'badge badge-unpaid') + '">' +
              (x.signedCount > 0 ? '+' : '') + x.signedCount + '</span>',
            dateTime(x.occurredAt),
            esc(x.note || '—'),
          ];
        }), 'Hələ əməliyyat yoxdur.'), true);

    var stockDialog = function (title, mode, requireNote) {
      // A write-off needs a type: DAMAGE and LOSS are different facts, and the
      // worker must choose rather than default silently to one of them.
      var typePicker = mode === 'wo'
        ? '<label class="field"><span class="field-label">Növ</span><select id="b-type">' +
          '<option value="DAMAGE">Zədələnmiş</option><option value="LOSS">İtmiş</option>' +
          '</select></label>'
        : '';
      // Taking is bounded by what is actually in the warehouse; saying so here
      // stops the round trip that would only come back as a 400.
      var countHint = mode === 'take' ? 'Anbarda ' + w.warehouseQuantity + ' bidon var' : '';
      openModal(title,
        typePicker +
        moneyField('b-count', 'Bidon sayı', '', countHint) +
        (requireNote ? textField('b-note', 'Səbəb', '') : textField('b-note', 'Qeyd (istəyə bağlı)', '')),
        [
          { label: 'Ləğv et', kind: 'outline' },
          { label: 'Təsdiqlə', kind: 'primary', onClick: function () {
            var body = {
              bottleCount: parseInt($('#b-count').value, 10) || 0,
              note: $('#b-note').value.trim(),
              idempotencyKey: idem(mode),
            };
            var call;
            if (mode === 'in') call = api('POST', '/inventory/stock-in', body);
            else if (mode === 'take') call = api('POST', '/inventory/issue', body);
            else if (mode === 'return') call = api('POST', '/inventory/return', body);
            else call = api('POST', '/inventory/write-off', Object.assign({ type: $('#b-type').value }, body));
            return call.then(function (r) {
              closeModal();
              toast(title + ' · yeni qalıq: ' + r.newBalance + ' bidon', 'ok');
              navigate('mystock');
            });
          } },
        ]);
    };

    $('#mb-in').addEventListener('click', function () { stockDialog('Anbara qəbul', 'in', false); });
    $('#mb-take').addEventListener('click', function () { stockDialog('Anbardan götür', 'take', false); });
    $('#mb-back').addEventListener('click', function () { stockDialog('Anbara qaytar', 'return', false); });
    $('#mb-wo').addEventListener('click', function () { stockDialog('Zədələnmiş / itmiş', 'wo', true); });
  }

  // ----------------------------------------------------------- profile ---
  async function pageProfile(view) {
    var me = await api('GET', '/auth/me');
    state.user = me;

    view.innerHTML =
      '<div class="cards">' +
        card('Ad', me.fullName) +
        card('İstifadəçi adı', me.username) +
        card('Rol', me.role === 'ADMIN' ? 'Administrator' : 'İşçi') +
        card('Son giriş', dateTime(me.lastLoginAt)) +
      '</div>' +
      (me.mustChangePassword
        ? '<div class="alert alert-error">Hesabınız üçün şifrə dəyişmək məcburdur.</div>'
        : '') +
      panel('Şifrəni dəyiş', '<button class="btn btn-primary btn-sm" id="pw-btn">Şifrə dəyiş</button>',
        '<div class="small muted">Şifrənizi dəyişdikdə bütun cihazlardan çıxış olacaq.</div>');

    $('#pw-btn').addEventListener('click', function () {
      openModal('Şifrəni dəyiş',
        textField('v-old', 'Cari şifrə', '', { type: 'password' }) +
        textField('v-new', 'Yeni şifrə (ən azı 8 simvol)', '', { type: 'password' }) +
        textField('v-new2', 'Yeni şifrə (təkrar)', '', { type: 'password' }),
        [
          { label: 'Ləğv et', kind: 'outline' },
          { label: 'Dəyiş', kind: 'primary', onClick: async function () {
            var a = $('#v-new').value, b = $('#v-new2').value;
            if (a !== b) throw new Error('Yeni şifrələr uyğun gəlmir.');
            await api('POST', '/auth/change-password', {
              currentPassword: $('#v-old').value,
              newPassword: a,
            });
            closeModal();
            clearSession();
            showLogin();
            toast('Şifrə dəyişdi. Yenidən daxil olun.', 'ok');
          } },
        ]);
    });
  }

  // --------------------------------------------------------- dashboard --
  async function pageDashboard(view) {
    var d = await api('GET', '/dashboard/admin');
    var inv = d.inventory || {};
    var fin = d.finance || {};
    var del = d.deliveries || {};

    var html = '<div class="cards">' +
      card('Anbarda bidon', inv.warehouseQuantity || 0) +
      card('İşçilərdə', inv.inWorkersHands || 0) +
      card('Bu gün daxil olan', inv.todayInbound || 0, 'good') +
      card('Bu gün çıxış', inv.todayIssuedToWorkers || 0, 'bad') +
      card('Bu gün yığlan pul', withMoney(fin.todayCollected || 0), 'good') +
      card('Bu ay yığlan pul', withMoney(fin.monthCollected || 0), 'good') +
      card('Ümumi borc', withMoney(fin.totalOutstandingDebt || 0), 'bad', (fin.debtorCustomers || 0) + ' müştəri') +
      card('Bugünkü çatdırılma', del.todayCount || 0, '', (del.todayBottles || 0) + ' bidon') +
      '</div>';

    html += '<div class="cards">' +
      card('Zədələnmiş', inv.damagedInRange || 0, 'bad') +
      card('İtmiş', inv.lostInRange || 0, 'bad') +
      card('Hesablanmış (faktura)', withMoney(fin.billedInRange || 0)) +
      card('Ödəniş sayı', fin.paymentsInRange || 0) +
      card('Çatdırılmamış dəyər', withMoney(fin.undeliveredValueInRange || 0)) +
      card('Ümumi çatdırılan bidon', del.allTimeBottles || 0) +
      '</div>';

    view.innerHTML = html +
      '<div class="alert alert-info">Göstəricilər yalnız faktiki ödənişlərdən hesablanır. Hesablanmış (faktura) məbləğ gəlir sayılmır.</div>';
  }

  // ----------------------------------------------------------- workers --
  async function pageWorkers(view) {
    var data = await api('GET', '/users?pageSize=100');

    var rows = data.items.map(function (u) {
      return [
        esc(u.fullName) + (u.isActive ? '' : ' <span class="badge badge-muted">deaktiv</span>'),
        esc(u.username),
        esc(u.phone || '—'),
        u.lastLoginAt ? dateTime(u.lastLoginAt) : '<span class="muted">heç girməyib</span>',
        '<div class="row-actions">' +
          (u.isActive
            ? '<button class="btn btn-outline btn-sm" data-act="deact" data-id="' + u.id + '">Deaktiv et</button>'
            : '<button class="btn btn-secondary btn-sm" data-act="act" data-id="' + u.id + '">Aktivləşdir</button>') +
          '<button class="btn btn-outline btn-sm" data-act="reset" data-id="' + u.id + '">Şifrə sıfırla</button>' +
        '</div>',
      ];
    });

    view.innerHTML =
      panel('İşçilər', '<button class="btn btn-primary btn-sm" id="add-worker">+ Yeni işçi</button>',
        table([
          { label: 'Ad' }, { label: 'İstifadəçi adı' }, { label: 'Telefon' },
          { label: 'Son giriş' }, { label: 'Əməliyyat', cls: 'actions' },
        ], rows, 'Hələ işçi yoxdur. "Yeni işçi" düyməsi ilə başlayın.'), true);

    $('#add-worker').addEventListener('click', openWorkerForm);

    $$('#view button[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.id;
        if (b.dataset.act === 'deact') setActive(id, false, b);
        else if (b.dataset.act === 'act') setActive(id, true, b);
        else if (b.dataset.act === 'reset') resetPassword(id, b);
      });
    });
  }

  async function setActive(id, active, btn) {
    btn.disabled = true;
    try {
      await api('PATCH', '/users/' + id, { isActive: active });
      toast(active ? 'İşçi aktivləşdirildi.' : 'İşçi deaktiv edildi.', 'ok');
      navigate('workers');
    } catch (e) {
      toast(e.message, 'err');
      btn.disabled = false;
    }
  }

  async function resetPassword(id, btn) {
    btn.disabled = true;
    try {
      var d = await api('POST', '/users/' + id + '/reset-password', {});
      openModal('Yeni şifrə',
        '<div class="alert alert-ok">Bu şifrəni işçiyə verin. O, ilk girişdə dəyişmək məcbur olacaq.</div>' +
        '<div style="font-size:20px;font-weight:700;text-align:center;padding:12px 0;font-family:monospace">' +
        esc(d.temporaryPassword) + '</div>',
        [{ label: 'Bağla', kind: 'primary' }]);
      toast('Şifrə sıfırlandı.', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function openWorkerForm() {
    openModal('Yeni işçi',
      textField('w-name', 'Ad, Soyad', '') +
      textField('w-user', 'İstifadəçi adı', '') +
      textField('w-phone', 'Telefon', '', { type: 'tel' }) +
      textField('w-email', 'E-mail (istəyə bağlı)', '', { type: 'email' }) +
      // A password field, not just a note about one: the API accepts an
      // explicit password and the admin should be able to set one.
      '<label class="field"><span class="field-label">Şifrə</span>' +
        '<span class="field-wrap">' +
          '<input id="w-pass" type="password" autocomplete="new-password" />' +
          '<button type="button" class="eye" id="w-eye" aria-label="Şifrəni göstər">👁</button>' +
        '</span>' +
        '<span class="field-label" style="margin-top:5px">Boş qoysan, sistem özü güclü şifrə yaradacaq.</span>' +
      '</label>',
      [
        { label: 'Ləğv et', kind: 'outline' },
        {
          label: 'Yarat',
          kind: 'primary',
          onClick: async function () {
            var pass = $('#w-pass').value.trim();
            // Mirror the server rule so the failure is not discovered on submit.
            if (pass && (pass.length < 8 || !/[A-Za-z]/.test(pass) || !/[0-9]/.test(pass))) {
              throw new Error('Şifrə ən azı 8 simvol olmalıdır və hərf və rəqəm içərməlidir.');
            }
            var body = {
              fullName: $('#w-name').value.trim(),
              username: $('#w-user').value.trim(),
              phone: $('#w-phone').value.trim() || undefined,
              email: $('#w-email').value.trim() || undefined,
              password: pass || undefined,
            };
            var d = await api('POST', '/users', body);
            closeModal();
            openModal('İşçi yaradıldı',
              '<div class="alert alert-ok">Bu şifrəni işçiyə verin. O, ilk girişdə dəyişmək məcbur olacaq.</div>' +
              '<div style="font-size:20px;font-weight:700;text-align:center;padding:12px 0;font-family:monospace">' +
              esc(d.temporaryPassword) + '</div>',
              [{ label: 'Bağla', kind: 'primary' }]);
            navigate('workers');
          },
        },
      ]);

    $('#w-eye').addEventListener('click', function () {
      var p = $('#w-pass');
      p.type = p.type === 'password' ? 'text' : 'password';
      this.textContent = p.type === 'password' ? '\uD83D\uDC41' : '\uD83D\uDD24';
    });
  }

  // ------------------------------------------------------------- stock --
  async function pageStock(view) {
    var s = await api('GET', '/inventory/summary');
    var t = await api('GET', '/inventory/transactions?pageSize=25');

    // Read-only: the worker receives, takes and returns stock; the admin watches
    // what came in and how much went out.
    var html = '<div class="cards">' +
      card('Anbarda qalan', s.warehouseQuantity || 0, 'good') +
      card('İşçilərdə', s.inWorkersHands || 0) +
      card('Sistemdə cəmi', s.totalSystemQuantity || 0) +
      card('Bu gün daxil', s.todayInbound || 0, 'good') +
      card('Bu gün çıxış', s.todayOutbound || 0, 'bad') +
      card('Zədələnmiş', s.damagedTotal || 0, 'bad') +
      card('İtmiş', s.lostTotal || 0, 'bad') +
      '</div>';

    html += '<div class="alert alert-info">' +
        'Anbarı işçi idarə edir: yeni gələn bidonları o qeyd edir və özü götürür. ' +
        'Burada hər götürmənin kim tərəfindən və nə qədər edildiyi görünür.' +
      '</div>';

    var workerRows = (s.workers || []).map(function (w) {
      return [esc(w.workerName), esc(w.username),
        w.isActive ? '' : '<span class="badge badge-muted">deaktiv</span>',
        w.quantity === 0 ? '<span class="badge badge-unpaid">0</span>' : String(w.quantity)];
    });
    html += panel('İşçilərin əlində — indi nə qədər qalıb', '', table(
      [{ label: 'Ad' }, { label: 'İstifadəçi adı' }, { label: 'Vəziyyət' }, { label: 'Qalan bidon', num: true }],
      workerRows, 'Hələ heç bir işçi yoxdur.'), true);

    // A take writes two legs - one out of the warehouse, one into the worker's
    // hands - and both carry the same actor. Naming the worker in the row is
    // what makes "who took what" answerable without reading the ledger.
    var txRows = (t.items || []).map(function (x) {
      var who = x.workerName || x.createdByName || '—';
      var by = esc(who) + (x.createdByRole === 'WORKER' ? ' <span class="badge badge-muted">işçi</span>' : '');
      var movement = esc(TX_LABEL[x.type] || x.type);
      if (x.type === 'ISSUE_TO_WORKER' && x.balanceKey === 'WAREHOUSE') {
        movement = 'Anbardan çıxdı';
      } else if (x.type === 'ISSUE_TO_WORKER') {
        movement = 'İşçiyə düşdü';
      }
      return [
        movement,
        '<span class="' + (x.signedCount > 0 ? 'badge badge-paid' : 'badge badge-unpaid') + '">' +
          (x.signedCount > 0 ? '+' : '') + x.signedCount + '</span>',
        dateTime(x.occurredAt),
        by,
        esc(x.note || '—'),
      ];
    });
    html += panel('Kim nə qədər götürdü / qaytardı', '', table(
      [{ label: 'Əməliyyat' }, { label: 'Say' }, { label: 'Tarix' }, { label: 'Kim' }, { label: 'Qeyd' }],
      txRows, 'Hələ əməliyyat yoxdur.'), true);

    view.innerHTML = html;
  }

  // --------------------------------------------------------- customers --
  async function pageCustomers(view) {
    var q = ($('#cust-q') && $('#cust-q').value.trim()) || '';
    var data = await api('GET', '/customers?pageSize=100' + (q ? '&search=' + encodeURIComponent(q) : ''));

    var rows = data.items.map(function (c) {
      return [
        esc(c.name),
        esc(c.phone || '—'),
        esc(c.address),
        String(c.deliveryCount || 0),
        String(c.totalBottles || 0),
        money(c.totalDebt),
        c.lastDeliveryAt ? date(c.lastDeliveryAt) : '—',
      ];
    });

    view.innerHTML =
      '<div class="toolbar">' +
        '<input id="cust-q" class="grow" placeholder="Ad və ya telefon ilə axtarın" value="' + esc(q) + '" />' +
        '<button class="btn btn-secondary" id="cust-search">Axtar</button>' +
        '<div class="spacer" style="flex:1"></div>' +
        '<button class="btn btn-primary" id="add-cust">+ Yeni müştəri</button>' +
      '</div>' +
      panel('Müştərilər (cəmi ' + data.total + ')', '',
        table([
          { label: 'Ad' }, { label: 'Telefon' }, { label: 'Ünvan' },
          { label: 'Çatdırılma', num: true }, { label: 'Bidon', num: true },
          { label: 'Borc', num: true }, { label: 'Son çatdırılma' },
        ], rows, 'Müştəri yoxdur.'), true);

    $('#cust-search').addEventListener('click', function () { navigate('customers'); });
    $('#cust-q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') navigate('customers');
    });
    $('#add-cust').addEventListener('click', function () {
      openModal('Yeni müştəri',
        textField('c-name', 'Ad, Soyad', '') +
        textField('c-phone', 'Telefon (istəyə bağlı)', '', { type: 'tel' }) +
        textField('c-addr', 'Ünvan', '', { multiline: true }) +
        textField('c-note', 'Qeyd (istəyə bağlı)', ''),
        [
          { label: 'Ləğv et', kind: 'outline' },
          { label: 'Yarat', kind: 'primary', onClick: function () {
            return api('POST', '/customers', {
              name: $('#c-name').value.trim(),
              phone: $('#c-phone').value.trim() || undefined,
              address: $('#c-addr').value.trim(),
              note: $('#c-note').value.trim() || undefined,
            }).then(function () {
              closeModal();
              toast('Müştəri əlavə olundu.', 'ok');
              navigate('customers');
            });
          } },
        ]);
    });
  }

  // -------------------------------------------------------- deliveries --
  async function pageDeliveries(view) {
    var url = '/deliveries?pageSize=50';
    var s = $('#del-s') ? $('#del-s').value : '';
    var st = $('#del-status') ? $('#del-status').value : '';
    if (s) url += '&search=' + encodeURIComponent(s);
    if (st) url += '&status=' + st;
    if ($('#del-debt') && $('#del-debt').checked) url += '&onlyDebts=true';

    var data = await api('GET', url);

    var rows = data.items.map(function (d) {
      return [
        date(d.deliveredAt),
        esc(WATER[d.waterType] || d.waterType || '—'),
        esc(d.destinationType === 'COMPANY' ? (d.officeName || d.companyName || 'Şirkət') : 'Ev'),
        esc(d.customerName || '—'),
        esc(d.workerName || '—'),
        String(d.bottleCount || 0),
        money(d.totalAmount),
        money(d.paidAmount),
        money(d.debtAmount),
        statusBadge(d.status),
        '<button class="btn btn-outline btn-sm" data-id="' + d.id + '">Aç</button>',
      ];
    });

    view.innerHTML =
      '<div class="toolbar">' +
        '<input id="del-s" class="grow" placeholder="Müştəri, ünvan və ya ofis" value="' + esc(s) + '" />' +
        '<select id="del-status"><option value="">Bütün statuslar</option>' +
          '<option value="UNPAID"' + (st === 'UNPAID' ? ' selected' : '') + '>Borc</option>' +
          '<option value="PARTIAL"' + (st === 'PARTIAL' ? ' selected' : '') + '>Qismən ödənilib</option>' +
          '<option value="PAID"' + (st === 'PAID' ? ' selected' : '') + '>Ödənilib</option>' +
        '</select>' +
        '<label class="small nowrap" style="display:flex;align-items:center;gap:5px">' +
          '<input type="checkbox" id="del-debt" style="width:auto" /> yalnız borclar</label>' +
        '<button class="btn btn-secondary" id="del-go">Filtr et</button>' +
        '<div style="flex:1"></div>' +
        '<button class="btn btn-primary" id="add-del">+ Yeni çatdırılma</button>' +
      '</div>' +
      panel('Çatdırılmalar (cəmi ' + data.total + ')', '',
        table([
          { label: 'Tarix' }, { label: 'Su' }, { label: 'Hara' }, { label: 'Müştəri' }, { label: 'İşçi' },
          { label: 'Bidon', num: true }, { label: 'Ümumi', num: true },
          { label: 'Ödənilən', num: true }, { label: 'Borc', num: true },
          { label: 'Status' }, { label: '', cls: 'actions' },
        ], rows, 'Çatdırılma yoxdur.'), true);

    $('#del-go').addEventListener('click', function () { navigate('deliveries'); });
    $('#del-s').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') navigate('deliveries');
    });
    $$('#view button[data-id]').forEach(function (b) {
      b.addEventListener('click', function () { openDelivery(b.dataset.id); });
    });
    $('#add-del').addEventListener('click', function () { openDelivery(null); });
  }

  async function openDelivery(id) {
    if (!id) return newDeliveryForm();
    var d = await api('GET', '/deliveries/' + id);
    var pays = await api('GET', '/payments/delivery/' + id);

    var rows = (pays.items || []).map(function (p) {
      return [dateTime(p.paidAt), money(p.amount), esc(METHOD[p.method] || p.method),
        p.voidedAt ? '<span class="badge badge-muted">ləğv</span>' : '',
        p.voidedAt ? '' : '<button class="btn btn-outline btn-sm" data-void="' + p.id + '">Ləğv et</button>'];
    });

    var destination = d.destinationType === 'COMPANY'
      ? esc((d.companyName || 'Şirkət') + (d.officeName ? ' — ' + d.officeName : ''))
      : 'Ev';
    // A delivery with no price yet is the normal state for a home drop: the
    // driver does not set prices, so the row stays at 0 until the admin fills
    // it in. Saying so plainly beats showing a confident "0.00 AZN".
    var priceMissing = Number(d.unitPrice) === 0;

    openModal('Çatdırılma · ' + date(d.deliveredAt),
      '<dl class="kv">' +
        '<dt>Müştəri</dt><dd>' + esc(d.customerName || '—') + '</dd>' +
        '<dt>İşçi</dt><dd>' + esc(d.workerName || '—') + '</dd>' +
        '<dt>Su</dt><dd>' + esc(WATER_FULL[d.waterType] || d.waterType) + '</dd>' +
        '<dt>Hara</dt><dd>' + destination + '</dd>' +
        '<dt>Ünvan</dt><dd>' + esc(d.address) + '</dd>' +
        '<dt>Bidon sayı</dt><dd>' + d.bottleCount + '</dd>' +
        '<dt>Bir bidon</dt><dd>' + (priceMissing ? '<span class="badge badge-warn">qiymət yazılmayıb</span>' : money(d.unitPrice) + ' AZN') + '</dd>' +
        '<dt>Ümumi</dt><dd>' + money(d.totalAmount) + ' AZN</dd>' +
        '<dt>Ödənilən</dt><dd>' + money(d.paidAmount) + ' AZN</dd>' +
        '<dt>Qalıq borc</dt><dd>' + money(d.debtAmount) + ' AZN</dd>' +
        '<dt>Status</dt><dd>' + statusBadge(d.status) + '</dd>' +
        (d.note ? '<dt>Qeyd</dt><dd>' + esc(d.note) + '</dd>' : '') +
      '</dl>' +
      (isAdmin() && d.status !== 'CANCELLED'
        ? '<div class="alert alert-info">Qiyməti və alınan pulu siz yazırsınız. Borc avtomatik hesablanır.</div>'
        : '') +
      '<div class="mt">' + table([
        { label: 'Tarix' }, { label: 'Məbləğ', num: true }, { label: 'Üsul' }, { label: '' }, { label: '', cls: 'actions' },
      ], rows, 'Ödəniş yoxdur.') + '</div>',
      [
        { label: 'Bağla', kind: 'outline' },
        ...(isAdmin() && d.status !== 'CANCELLED'
          ? [
              { label: 'Faktura', kind: 'outline', onClick: function () { closeModal(); invoice(d); } },
              { label: 'Qiymət / ödəniş', kind: 'primary', onClick: function () { closeModal(); deliveryPriceForm(d); } },
            ]
          : []),
      ]);

    $$('#modal-body button[data-void]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        api('POST', '/payments/' + b.dataset.void + '/void', {})
          .then(function () { toast('Ödəniş ləğv edildi.', 'ok'); closeModal(); openDelivery(id); })
          .catch(function (e) { toast(e.message, 'err'); b.disabled = false; });
      });
    });
  }

  /**
   * Admin-only: set the bottle price and state how much was collected.
   *
   * Both go in one save so the total, the debt and the status are recomputed
   * together; setting a price and then a payment separately would leave a
   * window where the row claims a debt that no longer exists.
   */
  function deliveryPriceForm(d) {
    openModal('Qiymət və ödəniş',
      '<div class="alert alert-info">Qiymət: <strong>' + money(d.unitPrice) + ' AZN</strong>' +
        ' · Ümumi: <strong>' + money(d.totalAmount) + ' AZN</strong>' +
        ' · Ödənilən: <strong>' + money(d.paidAmount) + ' AZN</strong></div>' +
      moneyField('e-price', 'Bir bidonun qiyməti', String(d.unitPrice ?? '0')) +
      moneyField('e-paid', 'Ödənilən məbləğ', String(d.paidAmount ?? '0'), '0 yazsanız tam ödənməmiş qalır') +
      textField('e-reason', 'Səbəb (istəyə bağlı)', '', {}),
      [
        { label: 'Ləğv et', kind: 'outline' },
        { label: 'Yadda saxla', kind: 'primary', onClick: function () {
          var reason = $('#e-reason').value.trim();
          var price = $('#e-price').value.trim();
          var paid = $('#e-paid').value.trim() || '0';
          if (parseFloat(paid) < 0) throw new Error('Ödənilən məbləğ negatif ola bilməz.');
          var total = parseFloat(price) * d.bottleCount;
          if (parseFloat(paid) > total) {
            throw new Error('Ödənilən məbləğ ümumi məbləğdən (' + money(total) + ') çox ola bilməz.');
          }
          return api('PATCH', '/deliveries/' + d.id, {
            unitPrice: price,
            paidAmount: paid,
            reason: reason,
          }).then(function () {
            closeModal();
            toast('Qiymət və ödəniş yazıldı.', 'ok');
            navigate('deliveries');
          });
        } },
      ]);
  }

  /** Printable invoice for one delivery - "faktura kimi çıxır". */
  function invoice(d) {
    var lines = [
      ['Faktura №', String(Date.now()).slice(-8)],
      ['Tarix', dateTime(d.deliveredAt)],
      ['Müştəri', d.customerName || '—'],
      ['Telefon', d.customerPhone || '—'],
      ['Su', WATER_FULL[d.waterType] || d.waterType || '—'],
      ['Hara', d.destinationType === 'COMPANY'
        ? ((d.companyName || 'Şirkət') + (d.officeName ? ' — ' + d.officeName : ''))
        : 'Ev'],
      ['Ünvan', d.address || '—'],
      ['İşçi', d.workerName || '—'],
      ['Bidon sayı', String(d.bottleCount)],
      ['Bir bidon', money(d.unitPrice) + ' AZN'],
      ['ÜMUMİ', money(d.totalAmount) + ' AZN'],
      ['Ödənilən', money(d.paidAmount) + ' AZN'],
      ['Qalıq borc', money(d.debtAmount) + ' AZN'],
      ['Status', d.status === 'PAID' ? 'Ödənilib' : d.status === 'PARTIAL' ? 'Qismən ödənilib' :
        d.status === 'CANCELLED' ? 'Ləğv edilib' : 'Ödənilməyib'],
    ];

    openModal('Faktura',
      '<div class="invoice" id="inv-box">' +
        '<div class="invoice-head">' +
          '<img src="/admin/assets/logo.svg" alt="" width="34" height="34" />' +
          '<div><strong>Farah Su Şirkəti</strong><br /><span class="small muted">Faktura</span></div>' +
        '</div>' +
        '<dl class="kv">' + lines.map(function (l) {
          return '<dt>' + esc(l[0]) + '</dt><dd>' + esc(l[1]) + '</dd>';
        }).join('') + '</dl>' +
      '</div>',
      [
        { label: 'Bağla', kind: 'outline' },
        { label: 'Çap et', kind: 'primary', onClick: function () { window.print(); } },
      ]);
  }


  /**
 * The new-delivery form.
 *
 * A worker records what physically happened - how many bottles, and where -
 * and nothing else. The price and the money collected are the admin's to
 * write, because both were previously typed here by the person carrying the
 * cash, which made the revenue figure unverifiable from the outside.
 *
 * The destination picker cascades: pick "Şirkət" and the company and office
 * selects appear; pick "Ev" and a free-text address appears instead. Only one
 * of the two is ever in the form, so the two can never disagree.
 */
function newDeliveryForm() {
    var companies = [];
    var dest = 'HOME';

    function companyOptions() {
      return companies.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('');
    }

    function officeOptions(companyId) {
      var c = companies.filter(function (x) { return x.id === companyId; })[0];
      if (!c || !c.offices.length) return '<option value="">Bu şirkətdə ofis yoxdur</option>';
      return c.offices.map(function (o) {
        return '<option value="' + o.id + '">' + esc(o.name) + '</option>';
      }).join('');
    }

    /** Which water segment is currently on. */
    function currentWater() {
      var on = $('#n-water-seg .is-on');
      return on ? on.dataset.v : 'FILTERED';
    }

    openModal('Yeni çatdırılma',
      // Su: which water. Everything downstream - the price, the reports - keys
      // off this, so it is asked first and never changes afterwards.
      '<div class="field"><span class="field-label">Su</span>' +
        '<div class="seg" id="n-water-seg">' +
          '<button type="button" class="seg-btn is-on" data-v="FILTERED">Filtr suyu</button>' +
          '<button type="button" class="seg-btn" data-v="SPRING">Bulaq suyu</button>' +
        '</div></div>' +

      // Hara: where it went.
      '<div class="field"><span class="field-label">Hara</span>' +
        '<div class="seg" id="n-dest-seg">' +
          '<button type="button" class="seg-btn is-on" data-v="HOME">Ev</button>' +
          '<button type="button" class="seg-btn" data-v="COMPANY">Şirkət</button>' +
        '</div></div>' +

      '<div id="n-company-wrap" hidden>' +
        '<label class="field"><span class="field-label">Şirkət</span>' +
          '<select id="n-company">' + companyOptions() + '</select></label>' +
        '<label class="field"><span class="field-label">Ofis</span>' +
          '<select id="n-office">' + officeOptions(companies[0] && companies[0].id) + '</select></label>' +
      '</div>' +

      '<label class="field" id="n-addr-wrap"><span class="field-label">Ünvan</span>' +
        '<input id="n-addr" placeholder="Məsələn: Bakı, Xəzər prospekti 12" /></label>' +

      // The customer is looked up the same way for both destinations.
      '<div id="n-customer-wrap">' +
        '<label class="field"><span class="field-label">Müştəri (ad və ya telefon)</span>' +
        '<input id="n-search" placeholder="Axtar…" /></label>' +
        '<div id="n-results" class="small"></div>' +
        '<div id="n-picked" class="alert alert-ok" hidden></div>' +
        '<label class="field" id="n-manual-wrap"><span class="field-label">Və ya yeni müştəri adı</span>' +
        '<input id="n-name" /></label>' +
      '</div>' +

      moneyField('n-count', 'Bidon sayı', '') +
      textField('n-date', 'Tarix', todayInput(), { type: 'date' }),
      [
        { label: 'Ləğv et', kind: 'outline' },
        { label: 'Yadda saxla', kind: 'primary', onClick: function () {
          var count = parseInt($('#n-count').value, 10) || 0;
          if (!count || count < 1) throw new Error('Bidon sayı ən azı 1 olmalıdır.');

          if (dest === 'COMPANY') {
            if (!$('#n-company').value || !$('#n-office').value) {
              throw new Error('Şirkət və ofis seçilməlidir.');
            }
          } else if ($('#n-addr').value.trim().length < 3) {
            throw new Error('Evə çatdırılmada ünvan yazılmalıdır.');
          }

          // A company delivery names the company, not a person, so there is no
          // customer field to send and none is required. The server attaches
          // the company itself.
          var picked = dest === 'COMPANY' ? '' : $('#n-picked').dataset.id;

          return api('POST', '/deliveries', {
            customerId: picked || undefined,
            customerName: dest === 'COMPANY'
              ? undefined
              : (picked ? undefined : $('#n-name').value.trim()),
            waterType: currentWater(),
            destinationType: dest,
            companyId: dest === 'COMPANY' ? $('#n-company').value : undefined,
            officeId: dest === 'COMPANY' ? $('#n-office').value : undefined,
            address: dest === 'HOME' ? $('#n-addr').value.trim() : undefined,
            bottleCount: count,
            deliveredAt: $('#n-date').value + 'T12:00:00.000Z',
            idempotencyKey: idem('d'),
          }).then(function () {
            closeModal();
            toast('Çatdırılma qeydə alındı.', 'ok');
            navigate('deliveries');
          });
        } },
      ]);

    // Segment buttons carry their value in a hidden input so the submit path
    // reads one place rather than tracking which button is "on" in a variable.
    $('#n-water-seg').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn');
      if (!b) return;
      $$('#n-water-seg .seg-btn').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    });
    $('#n-dest-seg').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn');
      if (!b) return;
      $$('#n-dest-seg .seg-btn').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      dest = b.dataset.v;
      $('#n-company-wrap').hidden = dest !== 'COMPANY';
      $('#n-addr-wrap').hidden = dest !== 'HOME';
      // A company delivery names a company, not a person. Showing a customer
      // picker there would invite a name that contradicts the office.
      $('#n-customer-wrap').hidden = dest === 'COMPANY';
    });

    $('#n-company').addEventListener('change', function () {
      $('#n-office').innerHTML = officeOptions(this.value);
    });

    var timer = null;
    $('#n-search').addEventListener('input', function (e) {
      var v = e.target.value.trim();
      clearTimeout(timer);
      if (v.length < 2) { $('#n-results').innerHTML = ''; return; }
      timer = setTimeout(function () {
        api('GET', '/customers?search=' + encodeURIComponent(v) + '&pageSize=6')
          .then(function (d) {
            $('#n-results').innerHTML = d.items.length
              ? d.items.map(function (c) {
                  return '<div><a href="#" data-cid="' + c.id + '" data-cname="' + esc(c.name) +
                    '" style="display:block;padding:5px 0">' + esc(c.name) +
                    (c.phone ? ' · ' + esc(c.phone) : '') + '</a></div>';
                }).join('')
              : '<span class="muted">Tapılmadı — aşağıda yeni müştəri yazın.</span>';
            $$('#n-results a').forEach(function (a) {
              a.addEventListener('click', function (ev) {
                ev.preventDefault();
                $('#n-picked').hidden = false;
                $('#n-picked').dataset.id = a.dataset.cid;
                $('#n-picked').innerHTML = 'Seçilib: <strong>' + esc(a.dataset.cname) + '</strong>';
                $('#n-manual-wrap').hidden = true;
                $('#n-results').innerHTML = '';
                $('#n-search').value = '';
              });
            });
          })
          .catch(function () {});
      }, 250);
    });

    // The picker needs the company list before the form can offer any choice,
    // and failing to load it must say so rather than leave empty selects.
    api('GET', '/companies')
      .then(function (rows) {
        companies = rows;
        if (!companies.length) {
          $('#n-company').innerHTML = '<option value="">Şirkət yoxdur</option>';
          $('#n-office').innerHTML = '';
          return;
        }
        $('#n-company').innerHTML = companyOptions();
        $('#n-office').innerHTML = officeOptions(companies[0].id);
      })
      .catch(function (e) {
        $('#n-company').innerHTML = '<option value="">Yüklənə bilmədi</option>';
        toast(e.message, 'err');
      });
  }

  // ------------------------------------------------------------- debts --
  async function pageDebts(view) {
    var data = await api('GET', '/debts?pageSize=100');

    var rows = data.items.map(function (d) {
      return [
        date(d.deliveredAt),
        esc(d.customerName || '—'),
        esc(d.workerName || '—'),
        String(d.bottleCount || 0),
        money(d.totalAmount),
        money(d.paidAmount),
        money(d.debtAmount),
        '<button class="btn btn-outline btn-sm" data-id="' + d.id + '">Borc güzəşti</button>',
      ];
    });

    view.innerHTML =
      '<div class="cards">' +
        card('Ümumi borc', withMoney(data.totalDebt || 0), 'bad') +
        card('Borclu müştəri', data.items.length) +
      '</div>' +
      panel('Borclar', '',
        table([
          { label: 'Tarix' }, { label: 'Müştəri' }, { label: 'İşçi' },
          { label: 'Bidon', num: true }, { label: 'Ümumi', num: true },
          { label: 'Ödənilən', num: true }, { label: 'Borc', num: true },
          { label: '', cls: 'actions' },
        ], rows, 'Borc yoxdur.'), true);

    $$('#view button[data-id]').forEach(function (b) {
      b.addEventListener('click', function () {
        var row = data.items.filter(function (x) { return x.id === b.dataset.id; })[0];
        openModal('Borc güzəşti',
          '<div class="alert alert-info">' + esc(row.customerName) + ' · qalıq borc ' +
            '<strong>' + money(row.debtAmount) + ' AZN</strong></div>' +
          moneyField('a-amount', 'Güzəş məbləği', String(row.debtAmount), 'Düzəliş gəlir sayılmır — yalnız ödəniş gəlirdir') +
          textField('a-note', 'Səbəb (istəyə bağlı)', ''),
          [
            { label: 'Ləğv et', kind: 'outline' },
            { label: 'Təsdiqlə', kind: 'primary', onClick: function () {
              return api('POST', '/debts/adjustments', {
                deliveryId: row.id,
                type: 'FORGIVE',
                amount: $('#a-amount').value.trim(),
                reason: $('#a-note').value.trim(),
              }).then(function () {
                closeModal();
                toast('Borc güzəşdi qeydə alındı.', 'ok');
                navigate('debts');
              });
            } },
          ]);
      });
    });
  }

  // ----------------------------------------------------------- revenue --
  async function pageRevenue(view) {
    var d = await api('GET', '/dashboard/revenue');

    var byMethod = (d.byMethod || []).map(function (m) {
      return [esc(METHOD[m.method] || m.method), String(m.count), money(m.amount)];
    });
    var byWorker = (d.byWorker || []).map(function (w) {
      return [esc(w.workerName), esc(w.username), String(w.count), money(w.amount)];
    });

    view.innerHTML =
      '<div class="alert alert-info">Gəlir yalnız qeydə alınmış, ləğv edilməmiş ödənişlərdən hesablanır.</div>' +
      panel('Üsul üzrə', '', table(
        [{ label: 'Üsul' }, { label: 'Say', num: true }, { label: 'Məbləğ', num: true }],
        byMethod, 'Bu dövrdə ödəniş yoxdur.'), true) +
      panel('İşçi üzrə', '', table(
        [{ label: 'İşçi' }, { label: 'İstifadəçi adı' }, { label: 'Say', num: true }, { label: 'Məbləğ', num: true }],
        byWorker, 'Bu dövrdə ödəniş yoxdur.'), true);
  }

  // ----------------------------------------------------------- reports --
  var REPORTS = [
    { type: 'daily', label: 'Günlük' },
    { type: 'period', label: 'Müəyyən aralıq' },
    { type: 'worker', label: 'İşçi üzrə' },
    { type: 'customer', label: 'Müştəri üzrə' },
    { type: 'inventory', label: 'Anbar' },
    { type: 'payments', label: 'Ödənişlər' },
    { type: 'deliveries', label: 'Çatdırılmalar' },
  ];

  /**
   * Downloads a report file.
   *
   * fetch() is used rather than a plain link because the endpoint requires an
   * Authorization header; a bare <a download> would receive 401. The response
   * is turned into an object URL and released afterwards so repeated exports
   * do not leak memory.
   */
  async function downloadReport(path, fallbackName, expectedExt) {
    var btn = document.activeElement;
    if (btn && btn.tagName === 'BUTTON') { btn.disabled = true; btn.textContent = 'Yüklənir…'; }
    try {
      var res = await fetch(API + path, { headers: { authorization: 'Bearer ' + state.token } });
      if (!res.ok) {
        var t = await res.text();
        var msg = 'Yükləmə alınmadı.';
        try { msg = JSON.parse(t).error.message || msg; } catch (e) { /* keep default */ }
        throw new Error(msg);
      }
      var blob = await res.blob();
      var name = fallbackName;
      var cd = res.headers.get('content-disposition') || '';
      var m = /filename="([^"]+)"/.exec(cd);
      if (m) name = m[1];

      // The server's slugified name is used as-is, but the extension must match
      // what the button promised: a .xls download that lands as ".xls.txt" is
      // worse than no download.
      if (expectedExt) {
        name = name.replace(/\.[a-z0-9]+$/i, '') + expectedExt;
      }

      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast(name + ' yükləndi.', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      if (btn && btn.tagName === 'BUTTON') {
        btn.disabled = false;
        btn.textContent = btn.dataset.label || btn.textContent;
      }
    }
  }

  async function pageReports(view) {
    var monthOpts = ['', 'last'];
    // Offer the last 18 months so the common case needs no date arithmetic.
    var now = new Date();
    for (var i = 0; i < 18; i++) {
      var d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
      monthOpts.push(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'));
    }

    // Six years back plus the current one: a yearly report is asked for when
    // reconciling accounts, which is rarely the current year alone.
    var thisYear = new Date().getUTCFullYear();
    var yearOpts = [{ v: '', t: 'Bu il' }];
    for (var yi = 0; yi < 6; yi++) {
      var yy = thisYear - yi;
      yearOpts.push({ v: String(yy), t: yi === 0 ? String(yy) + ' (bu il)' : String(yy) });
    }

    view.innerHTML =
      // Monthly and yearly get their own blocks for the same reason: these are
      // the two reports an owner actually asks for, and neither should be
      // reachable only by typing a date range.
      '<div class="panel"><div class="panel-head"><h3>📅 Aylıq hesabat</h3>' +
        '<div class="spacer"></div>' +
        '<select id="m-month"><option value="">Bu ay</option><option value="last">Keçən ay</option>' +
        monthOpts.slice(2).map(function (mm) {
          var parts = mm.split('-');
          var names = ['Yanvar','Fevral','Mart','Aprel','May','İyun','İyul','Avqust','Sentyabr','Oktyabr','Noyabr','Dekabr'];
          return '<option value="' + mm + '">' + names[+parts[1] - 1] + ' ' + parts[0] + '</option>';
        }).join('') +
        '</select></div>' +
        '<div class="panel-body">' +
          '<div class="toolbar" style="margin-bottom:0">' +
            '<button class="btn btn-primary" data-mf="xls" data-ml="Excel 97 (.xls)">📗 Excel (.xls)</button>' +
            '<button class="btn btn-secondary" data-mf="xlsx" data-ml="Excel (.xlsx)">📊 Excel (.xlsx)</button>' +
            '<button class="btn btn-outline" data-mf="csv" data-ml="CSV">📄 CSV</button>' +
            '<button class="btn btn-outline" data-mf="pdf" data-ml="PDF">📕 PDF</button>' +
            '<div style="flex:1"></div>' +
            '<button class="btn btn-outline" id="m-view">Ekranda gör</button>' +
          '</div>' +
          '<div class="small muted" style="margin-top:8px">Aylıq hesabat yalnız seçilmiş ayın məlumatını əhatə edir.</div>' +
        '</div></div>' +

      '<div class="panel"><div class="panel-head"><h3>📆 İllik hesabat</h3>' +
        '<div class="spacer"></div>' +
        '<select id="y-year">' + yearOpts.map(function (y) {
          return '<option value="' + y.v + '"' + (y.sel ? ' selected' : '') + '>' + esc(y.t) + '</option>';
        }).join('') + '</select></div>' +
        '<div class="panel-body">' +
          '<div class="toolbar" style="margin-bottom:0">' +
            '<button class="btn btn-primary" data-yf="xls" data-ml="Excel 97 (.xls)">📗 Excel (.xls)</button>' +
            '<button class="btn btn-secondary" data-yf="xlsx" data-ml="Excel (.xlsx)">📊 Excel (.xlsx)</button>' +
            '<button class="btn btn-outline" data-yf="csv" data-ml="CSV">📄 CSV</button>' +
            '<button class="btn btn-outline" data-yf="pdf" data-ml="PDF">📕 PDF</button>' +
            '<div style="flex:1"></div>' +
            '<button class="btn btn-outline" id="y-view">Ekranda gör</button>' +
          '</div>' +
          '<div class="small muted" style="margin-top:8px">İllik hesabat yalnız seçilmiş ilin məlumatını əhatə edir.</div>' +
        '</div></div>' +

      '<div class="toolbar"><select id="r-type">' +
        REPORTS.map(function (r) { return '<option value="' + r.type + '">' + esc(r.label) + '</option>'; }).join('') +
      '</select>' +
      '<input type="date" id="r-from" />' +
      '<input type="date" id="r-to" />' +
      '<button class="btn btn-primary" id="r-go">Hesabatı göstər</button>' +
      '<div style="flex:1"></div>' +
      '<button class="btn btn-primary" id="r-xls" data-label="Excel 97 (.xls)">📗 .xls</button>' +
      '<button class="btn btn-primary" id="r-xlsx" data-label="Excel (.xlsx)">📊 .xlsx</button>' +
      '<button class="btn btn-secondary" id="r-csv" data-label="CSV">📄 CSV</button>' +
      '<button class="btn btn-outline" id="r-pdf" data-label="PDF">📕 PDF</button>' +
      '</div>' +
      '<div id="r-out"><div class="loader">Hesabat seçin…</div></div>';

    var params = function () {
      var t = $('#r-type').value;
      var p = ['type=' + t];
      if ($('#r-from').value) p.push('from=' + $('#r-from').value);
      if ($('#r-to').value) p.push('to=' + $('#r-to').value);
      return p.join('&');
    };

    var monthlyPath = function (format) {
      var m = $('#m-month').value;
      return '/reports/monthly?format=' + format + (m ? '&month=' + encodeURIComponent(m) : '');
    };

    var yearlyPath = function (format) {
      var y = $('#y-year').value;
      return '/reports/yearly?format=' + format + (y ? '&year=' + encodeURIComponent(y) : '');
    };

    var showReport = function (rep) {
      var html = '<div class="panel"><div class="panel-head"><h3>' + esc(rep.title) + '</h3>' +
        '<div class="spacer"></div><span class="small muted">' + esc(rep.subtitle || '') +
        ' · ' + dateTime(rep.generatedAt) + '</span></div><div class="panel-body flush">';
      (rep.sections || []).forEach(function (s) {
        var hasTotals = Boolean(s.totals);
        html += '<div class="panel-head" style="background:var(--primary-light)"><h3 style="font-size:13px">' +
          esc(s.heading) + '</h3></div>' +
          table(s.columns.map(function (c, i) { return { label: c, num: i > 0 }; }),
            s.rows.map(function (r) {
              return r.map(function (c, i) { return i === 0 ? esc(c) : '<span class="mono">' + esc(c) + '</span>'; });
            }).concat(hasTotals ? [s.totals.map(function (c, i) {
              return '<strong>' + (i === 0 ? esc(c) : '<span class="mono">' + esc(c) + '</span>') + '</strong>';
            })] : []), 'Boş');
      });
      return html + '</div></div>';
    };

    $('#r-go').addEventListener('click', function () {
      var out = $('#r-out');
      out.innerHTML = '<div class="loader">Yüklənir…</div>';
      api('GET', '/reports?' + params())
        .then(function (rep) { out.innerHTML = showReport(rep); })
        .catch(function (e) { out.innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>'; });
    });

    $('#m-view').addEventListener('click', function () {
      var out = $('#r-out');
      out.innerHTML = '<div class="loader">Yüklənir…</div>';
      var q = $('#m-month').value ? '?month=' + encodeURIComponent($('#m-month').value) : '';
      api('GET', '/reports/monthly' + q)
        .then(function (rep) { out.innerHTML = showReport(rep); })
        .catch(function (e) { out.innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>'; });
    });

    $('#r-xls').addEventListener('click', function () { downloadReport('/reports?' + params() + '&format=xls', 'hesabat.xls', '.xls'); });
    $('#r-xlsx').addEventListener('click', function () { downloadReport('/reports?' + params() + '&format=xlsx', 'hesabat.xlsx', '.xlsx'); });
    $('#r-csv').addEventListener('click', function () { downloadReport('/reports?' + params() + '&format=csv', 'hesabat.csv', '.csv'); });
    $('#r-pdf').addEventListener('click', function () { downloadReport('/reports?' + params() + '&format=pdf', 'hesabat.pdf', '.pdf'); });

    $$('#view button[data-mf]').forEach(function (b) {
      b.dataset.label = b.textContent;
      b.addEventListener('click', function () {
        var ext = b.dataset.mf === 'xls' ? '.xls' : '.' + b.dataset.mf;
        downloadReport(monthlyPath(b.dataset.mf), 'ayliq-hesabat' + ext, ext);
      });
    });

    $('#y-view').addEventListener('click', function () {
      var out = $('#r-out');
      out.innerHTML = '<div class="loader">Yüklənir…</div>';
      var y = $('#y-year').value;
      api('GET', '/reports/yearly' + (y ? '?year=' + encodeURIComponent(y) : ''))
        .then(function (rep) { out.innerHTML = showReport(rep); })
        .catch(function (e) { out.innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>'; });
    });

    $$('#view button[data-yf]').forEach(function (b) {
      b.addEventListener('click', function () {
        var ext = b.dataset.yf === 'xls' ? '.xls' : '.' + b.dataset.yf;
        downloadReport(yearlyPath(b.dataset.yf), 'illik-hesabat' + ext, ext);
      });
    });
  }

  // ------------------------------------------------------------- audit --
  async function pageAudit(view) {
    var data = await api('GET', '/audit/logs?pageSize=100');
    var rows = data.items.map(function (a) {
      return [dateTime(a.createdAt), esc(a.actorName || '—'),
        esc(a.actorRole || ''), esc(a.action), esc(a.entityType || '—'), esc(a.ip || '—')];
    });
    view.innerHTML = panel('Audit jurnalı (son 100)', '', table(
      [{ label: 'Tarix' }, { label: 'Kim' }, { label: 'Rol' }, { label: 'Əməliyyat' },
       { label: 'Obyekt' }, { label: 'IP' }],
      rows, 'Jurnal boşdur.'), true);
  }

  // -------------------------------------------------------------- boot ---
  async function boot() {
    if (!loadSession()) { showLogin(); return; }
    try {
      var me = await api('GET', '/auth/me');
      state.user = me;
      localStorage.setItem(LS_USER, JSON.stringify(me));
      showShell();
      navigate((location.hash || '#dashboard').slice(1));
    } catch (e) {
      clearSession();
      showLogin();
    }
  }

  boot();
})();
