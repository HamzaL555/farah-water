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

  /**
   * DD.MM.YYYY HH:MM:SS in Baku time.
   *
   * Warehouse history and admin notifications promise the exact second an
   * operation happened, so this variant is used wherever an audit trail is on
   * screen. It is still rendered from the server timestamp, never the device.
   */
  function dateTimeFull(v) {
    if (!v) return '—';
    var d = baku(v);
    if (!d) return '—';
    return date(v) + ' ' +
      String(d.getUTCHours()).padStart(2, '0') + ':' +
      String(d.getUTCMinutes()).padStart(2, '0') + ':' +
      String(d.getUTCSeconds()).padStart(2, '0');
  }

  var DAY_NAMES = ['Bazar', 'Bazar ertəsi', 'Çərşənbə axşamı', 'Çərşənbə', 'Cümə axşamı', 'Cümə', 'Şənbə'];

  /**
   * YYYY-MM-DD for the Baku day `days` away from today (0 = today, -1 = yesterday).
   *
   * Every Baku day is exactly 24 hours long because the offset has no daylight
   * saving, so stepping 86400000 ms moves exactly one calendar day.
   */
  function dayOffsetIso(days) {
    return new Date(Date.now() + BAKU_OFFSET_MS + days * 86400000).toISOString().slice(0, 10);
  }

  /** "Bu gün" / "Dünən" / the weekday, whichever reads best for that day. */
  function dayRelativeName(iso) {
    if (iso === dayOffsetIso(0)) return 'Bu gün';
    if (iso === dayOffsetIso(-1)) return 'Dünən';
    return DAY_NAMES[new Date(iso + 'T00:00:00Z').getUTCDay()] || iso;
  }

  /**
   * Accepts DD.MM.YYYY and returns YYYY-MM-DD, or '' if it is not a real date.
   *
   * The native date input was showing 10/14/2026 because the browser was set
   * to en-US: it renders month first, which is the opposite of how every other
   * date in this system reads, and "14 October" typed as "10/14" is a month
   * that does not exist. The format is ours to fix; the browser's is not.
   */
  function parseAzerbaijaniDate(text) {
    var raw = String(text || '').trim();
    if (!raw) return '';
    var m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw);
    var day, mon, year;
    if (m) {
      day = +m[1]; mon = +m[2]; year = +m[3];
    } else {
      var m2 = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(raw);
      if (!m2) return '';
      year = +m2[1]; mon = +m2[2]; day = +m2[3];
    }
    if (mon < 1 || mon > 12 || day < 1 || year < 2000 || year > 2100) return '';
    if (day > new Date(Date.UTC(year, mon, 0)).getUTCDate()) return '';
    return year + '-' + String(mon).padStart(2, '0') + '-' + String(day).padStart(2, '0');
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
    ISSUE_TO_WORKER: 'İşçiyə verildi',
    OUT_DELIVERY: 'Çatdırılmada istifadə',
    RETURN_TO_STOCK: 'Anbara qaytarıldı',
    DAMAGE: 'Zədələnmiş',
    LOSS: 'İtmiş',
    CORRECTION: 'Düzəliş',
  };

  var TX_ACTIONS = ['INBOUND', 'ISSUE_TO_WORKER', 'OUT_DELIVERY', 'RETURN_TO_STOCK', 'DAMAGE', 'LOSS'];

  var WORKER_TYPE = {
    WAREHOUSE_KEEPER: { label: 'Anbardar', cls: 'badge-info' },
    REGULAR: { label: 'Adi işçi', cls: 'badge-muted' },
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
      if (r.json && r.json.error) {
        if (r.json.error.details && typeof r.json.error.details === 'object') {
          var dvals = Object.keys(r.json.error.details).map(function (k) { return r.json.error.details[k]; }).filter(Boolean);
          if (dvals.length) msg = dvals[0];
          else msg = r.json.error.message || msg;
        } else {
          msg = r.json.error.message || msg;
        }
      } else if (r.text) {
        msg = r.text.slice(0, 200);
      }
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
    var roleLabel = state.user.role === 'ADMIN'
      ? 'administrator'
      : (state.user.workerType === 'WAREHOUSE_KEEPER' ? 'anbardar' : 'adi işçi');
    who.innerHTML = '<strong>' + esc(state.user.fullName || '') + '</strong><br>' +
                    esc(state.user.username || '') + ' · ' + esc(roleLabel);
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
    {
      id: 'stock', icon: '🏭', label: 'Anbar', roles: ['ADMIN', 'WORKER'],
      // Keeper or admin only: a regular worker can never open the anbar.
      show: canManageWarehouse,
    },
    { id: 'notifications', icon: '🔔', label: 'Bildirişlər', roles: ['ADMIN'] },
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

  /** Unread badge on the notifications item; silent when offline. */
  function refreshNotifBadge() {
    if (!isAdmin()) return;
    api('GET', '/notifications/unread-count')
      .then(function (d) {
        var el = $('#notif-badge');
        if (!el) return;
        var n = d && d.count ? Number(d.count) : 0;
        el.textContent = n > 99 ? '99+' : String(n);
        el.hidden = n === 0;
      })
      .catch(function () { /* a badge is never worth a failed request banner */ });
  }

  function buildNav() {
    $('#nav').innerHTML = PAGES.filter(function (p) { return canOpen(p.id); }).map(function (p) {
      var label = p.icon + ' ' + esc(p.label);
      if (p.id === 'notifications') {
        label += ' <span class="nav-badge" id="notif-badge" hidden></span>';
      }
      return '<a href="#" data-page="' + p.id + '">' + label + '</a>';
    }).join('');
    $$('#nav a').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        setDrawer(false);
        navigate(a.dataset.page);
      });
    });
    refreshNotifBadge();
  }

  /** Guards direct navigation to a page the current role must not open. */
  function canOpen(page) {
    var def = PAGES.filter(function (p) { return p.id === page; })[0];
    if (!def) return false;
    if (def.show) return def.show();
    return def.roles.indexOf(role()) >= 0;
  }

  function navigate(page) {
    if (!canOpen(page)) {
      page = isAdmin() ? 'dashboard' : (canManageWarehouse() ? 'stock' : 'mystock');
    }
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
      .then(function () {
        lastSignature[page] = signatureOf(page);
        refreshNotifBadge();
      })
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

  /**
   * A large, colour-coded water type card. Bulaq and Filtr never share one
   * number: the whole point of the module is that they are separate stocks.
   */
  function waterCard(label, value, kind, unit) {
    return '<div class="water-card ' + (kind || '') + '">' +
      '<div class="water-card-label">' + esc(label) + '</div>' +
      '<div class="water-card-value">' + esc(String(value == null ? 0 : value)) + '</div>' +
      '<div class="water-card-unit">' + esc(unit || 'bidon') + '</div>' +
      '</div>';
  }

  function statusBadge(s) {
    var st = STATUS[s] || { label: s || '—', cls: 'badge-muted' };
    return '<span class="badge ' + st.cls + '">' + esc(st.label) + '</span>';
  }

  /** Bulaq and Filtr are visually distinct everywhere, never one grey label. */
  function waterBadge(w) {
    var label = WATER_FULL[w] || w || '—';
    return '<span class="badge ' + (w === 'SPRING' ? 'badge-spring' : 'badge-filtered') + '">' +
      esc(label) + '</span>';
  }

  function signedBadge(n) {
    var v = Number(n) || 0;
    return '<span class="badge ' + (v >= 0 ? 'badge-paid' : 'badge-unpaid') + '">' +
      (v > 0 ? '+' : '') + v + '</span>';
  }

  function workerTypeBadge(t) {
    var w = WORKER_TYPE[t] || { label: 'Təyin edilməyib', cls: 'badge-muted' };
    return '<span class="badge ' + w.cls + '">' + esc(w.label) + '</span>';
  }

  /** True for an anbardar (warehouse keeper). */
  function isKeeper() {
    return Boolean(state.user && state.user.role === 'WORKER' &&
      state.user.workerType === 'WAREHOUSE_KEEPER');
  }

  /** Admin can see the anbar; only the keeper (and admin) can open its page. */
  function canManageWarehouse() {
    return isAdmin() || isKeeper();
  }

  /** Reads the currently selected value of a .seg control. */
  function segValue(selector) {
    var on = $(selector + ' .seg-btn.is-on');
    return on ? on.dataset.v : '';
  }

  /** Wires a .seg control so exactly one button is ever selected. */
  function bindSeg(selector) {
    var el = $(selector);
    if (!el) return;
    el.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.seg-btn');
      if (!btn) return;
      $$(selector + ' .seg-btn').forEach(function (x) {
        x.classList.toggle('is-on', x === btn);
      });
    });
  }

  function waterSeg(id, selected) {
    return '<div class="seg" id="' + id + '">' +
      '<button type="button" class="seg-btn' + (selected === 'SPRING' ? '' : ' is-on') + '" data-v="FILTERED">💧 Filtr suyu</button>' +
      '<button type="button" class="seg-btn' + (selected === 'SPRING' ? ' is-on' : '') + '" data-v="SPRING">🏔️ Bulaq suyu</button>' +
      '</div>';
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

  /**
   * The delivery date, as one tap for today and DD.MM.YYYY for anything else.
   *
   * A delivery is recorded the day it happens, so today is the answer nearly
   * every time and it should not be typed. Three buttons cover the case that
   * actually turns up - a round that finished late, a phone that was out of
   * credit - and the text field underneath takes any other day in the same
   * format every other date in this system uses.
   */
  function dateField() {
    var recent = [0, -1, -2];
    var chips = recent.map(function (n) {
      var iso = dayOffsetIso(n);
      return '<button type="button" class="btn btn-outline btn-sm" data-day="' + iso + '">' +
        esc(dayRelativeName(iso)) + '</button>';
    }).join('');
    return '<div class="field">' +
      '<span class="field-label">Çatdırılma tarixi</span>' +
      '<div class="chip-row" id="n-day-chips">' + chips + '</div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<input id="n-date" type="text" inputmode="numeric" placeholder="GG.AA.İLİ" ' +
        'maxlength="10" value="' + date(dayOffsetIso(0)) + '" style="flex:1" />' +
        '<button type="button" class="btn btn-outline" id="n-cal-btn" title="Təqvimdən seç" style="padding:7px 11px;font-size:15px;line-height:1">📅</button>' +
        '<input id="n-date-picker" type="date" max="' + dayOffsetIso(0) + '" value="' + dayOffsetIso(0) + '" style="position:absolute;width:0;height:0;opacity:0;pointer-events:none" />' +
      '</div>' +
      '<span class="field-label" id="n-date-note" style="margin-top:4px">' +
      'Bu gün: ' + esc(date(dayOffsetIso(0))) + '</span>' +
      '</div>';
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
    refreshNotifBadge();
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
    if (page === 'notifications') return pageNotifications(view);
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
  /**
   * The worker's own bottles, per water type.
   *
   * A regular worker sees ONLY this: no warehouse total, no actions. The
   * anbardar hands them stock through the Anbar page; a delivery spends it
   * automatically. That is why this page never calls `/inventory/summary`.
   */
  async function pageMyStock(view) {
    var s = await api('GET', '/inventory/my-stock');
    // Scope to this worker explicitly: a keeper sees the whole ledger on the
    // Anbar page, but this page is about their OWN hands only.
    var t = await api(
      'GET',
      '/inventory/transactions?pageSize=30&workerId=' + encodeURIComponent(state.user.id),
    );

    var html = '<div class="wh-grid">' +
      waterCard('Bulaq suyu', s.springQty, 'spring') +
      waterCard('Filtr suyu', s.filteredQty, 'filtered') +
      waterCard('Ümumi balans', s.totalQty, 'total') +
      '</div>';

    html += '<div class="alert alert-info">' +
      (isKeeper()
        ? 'Anbar əməliyyatlarını "Anbar" səhifəsindən aparırsınız. Burada yalnız şəxsi balansınız görünür.'
        : 'Bidonları sizə anbardar təhvil verir. Çatdırılmada istifadə etdiyiniz bidonlar avtomatik balansınızdan çıxılır.') +
      '</div>';

    html += panel('Şəxsi bidon balansı', '', table(
      [{ label: 'Su növü' }, { label: 'Qalan bidon', num: true }],
      [
        [waterBadge('SPRING'), String(s.springQty || 0)],
        [waterBadge('FILTERED'), String(s.filteredQty || 0)],
        ['<strong>Cəmi</strong>', '<strong>' + (s.totalQty || 0) + '</strong>'],
      ], 'Balans yoxdur.'), true);

    html += panel('Mənim inventar tarixçəm', '', table(
      [
        { label: 'Tarix / saat' }, { label: 'Su növü' }, { label: 'Əməliyyat' },
        { label: 'Say', num: true }, { label: 'Balans' }, { label: 'Qeyd' },
      ],
      (t.items || []).map(function (x) {
        return [
          dateTimeFull(x.occurredAt),
          waterBadge(x.waterType),
          esc(TX_LABEL[x.type] || x.type),
          signedBadge(x.signedCount),
          balanceTransition(x),
          esc(x.note || '—'),
        ];
      }), 'Hələ əməliyyat yoxdur.'), true);

    view.innerHTML = html;
  }

  /** "200 → 180" for one ledger leg, or a dash for pre-migration rows. */
  function balanceTransition(x) {
    if (x.beforeBalance === null || x.beforeBalance === undefined ||
        x.afterBalance === null || x.afterBalance === undefined) return '—';
    return '<span class="mono">' + x.beforeBalance + ' → ' + x.afterBalance + '</span>';
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
    // Separate Bulaq/Filtr numbers, not just one combined total.
    var invSum = await api('GET', '/inventory/summary');
    var inv = d.inventory || {};
    var fin = d.finance || {};
    var del = d.deliveries || {};
    var wh = invSum.warehouse || { filtered: 0, spring: 0, total: 0 };

    var html = '<div class="wh-grid">' +
      waterCard('Anbarda Bulaq', wh.spring, 'spring') +
      waterCard('Anbarda Filtr', wh.filtered, 'filtered') +
      waterCard('Anbarda cəmi', wh.total, 'total') +
      '</div>';

    html += '<div class="cards">' +
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
        workerTypeBadge(u.workerType),
        u.lastLoginAt ? dateTime(u.lastLoginAt) : '<span class="muted">heç girməyib</span>',
        '<div class="row-actions">' +
          '<button class="btn btn-secondary btn-sm" data-act="type" data-id="' + u.id +
            '" data-name="' + esc(u.fullName) + '" data-type="' + esc(u.workerType || '') + '">Növ</button>' +
          (u.isActive
            ? '<button class="btn btn-outline btn-sm" data-act="deact" data-id="' + u.id + '">Deaktiv et</button>'
            : '<button class="btn btn-secondary btn-sm" data-act="act" data-id="' + u.id + '">Aktivləşdir</button>') +
          '<button class="btn btn-outline btn-sm" data-act="reset" data-id="' + u.id + '">Şifrə sıfırla</button>' +
        '</div>',
      ];
    });

    view.innerHTML =
      panel('İşçilər',
        '<button class="btn btn-primary btn-sm" id="add-worker">+ Yeni işçi</button>',
        '<div class="alert alert-info" style="margin:0 0 10px">' +
          '<strong>Anbardar</strong> anbara mal qəbul edir, işçilərə bidon verir və anbardan səbəbli çıxarış edir. ' +
          '<strong>Adi işçi</strong> yalnız öz balansını görür, anbara toxuna bilmir. Növü yalnız administrator təyin edir.' +
        '</div>' +
        table([
          { label: 'Ad' }, { label: 'İstifadəçi adı' }, { label: 'Telefon' },
          { label: 'Növ' }, { label: 'Son giriş' }, { label: 'Əməliyyat', cls: 'actions' },
        ], rows, 'Hələ işçi yoxdur. "Yeni işçi" düyməsi ilə başlayın.'), true);

    $('#add-worker').addEventListener('click', openWorkerForm);

    $$('#view button[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.id;
        if (b.dataset.act === 'deact') setActive(id, false, b);
        else if (b.dataset.act === 'act') setActive(id, true, b);
        else if (b.dataset.act === 'reset') resetPassword(id, b);
        else if (b.dataset.act === 'type') openWorkerTypeForm(id, b.dataset.name, b.dataset.type);
      });
    });
  }

  async function openWorkerTypeForm(id, fullName, current) {
    openModal('İşçi növü — ' + (fullName || ''),
      '<label class="field"><span class="field-label">Növ</span>' +
        '<select id="wt-type">' +
          '<option value="REGULAR"' + (current === 'REGULAR' ? ' selected' : '') + '>Adi işçi</option>' +
          '<option value="WAREHOUSE_KEEPER"' + (current === 'WAREHOUSE_KEEPER' ? ' selected' : '') + '>Anbardar</option>' +
        '</select>' +
      '</label>' +
      '<div class="alert alert-info" style="margin:0">Yalnız anbardar anbar əməliyyatlarını apara bilər. ' +
        'Adi işçi yalnız öz bidon balansını görür.</div>',
      [
        { label: 'Ləğv et', kind: 'outline' },
        { label: 'Yadda saxla', kind: 'primary', onClick: async function () {
          await api('PATCH', '/users/' + id, { workerType: $('#wt-type').value });
          closeModal();
          toast('İşçi növü yeniləndi.', 'ok');
          navigate('workers');
        } },
      ]);
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
      '<label class="field"><span class="field-label">İşçi növü</span>' +
        '<select id="w-worker-type">' +
          '<option value="REGULAR">Adi işçi — yalnız öz balansı</option>' +
          '<option value="WAREHOUSE_KEEPER">Anbardar — anbar əməliyyatları</option>' +
        '</select>' +
        '<span class="field-label" style="margin-top:5px">Növü yalnız administrator təyin edir.</span>' +
      '</label>' +
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
              workerType: $('#w-worker-type').value,
            };
            var d = await api('POST', '/users', body);
            closeModal();
            var hasTemp = Boolean(d.temporaryPassword);
            openModal('İşçi yaradıldı',
              '<div class="alert alert-ok">' +
                (hasTemp
                  ? 'Bu şifrəni işçiyə verin. O, ilk girişdə dəyişmək məcbur olacaq.'
                  : 'İşçi yaradıldı. Şifrə sizin təyin etdiyiniz şifrədir.') +
              '</div>' +
              (hasTemp
                ? '<div style="font-size:20px;font-weight:700;text-align:center;padding:12px 0;font-family:monospace">' +
                  esc(d.temporaryPassword) + '</div>'
                : ''),
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
  /**
   * Anbar: two separate water stocks, the handover form, per-worker holdings
   * and a filtered, append-only history. Visible to the anbardar and the admin.
   *
   * Actions are hidden rather than shown-then-rejected: the anbardar conducts
   * warehouse movements, the admin supervises and may hand stock to a worker.
   */
  var STOCK_FILTER = {
    preset: 'last30days',
    from: '',
    to: '',
    waterType: '',
    type: '',
    workerId: '',
    createdById: '',
  };

  function workerTypeLabel(t) {
    var w = WORKER_TYPE[t];
    return w ? w.label : 'Adi işçi';
  }

  function stockQuery(f) {
    var parts = ['pageSize=100'];
    if (f.from || f.to) {
      if (f.from) parts.push('from=' + encodeURIComponent(f.from));
      if (f.to) parts.push('to=' + encodeURIComponent(f.to));
    } else {
      parts.push('preset=' + encodeURIComponent(f.preset || 'last30days'));
    }
    if (f.waterType) parts.push('waterType=' + encodeURIComponent(f.waterType));
    if (f.type) parts.push('type=' + encodeURIComponent(f.type));
    if (f.workerId) parts.push('workerId=' + encodeURIComponent(f.workerId));
    if (f.createdById) parts.push('createdById=' + encodeURIComponent(f.createdById));
    return parts.join('&');
  }

  /** "200 → 180" for the warehouse leg of a movement. */
  function warehouseTransition(x) {
    if (!x || String(x.balanceKey || '').indexOf('WAREHOUSE') !== 0) return '—';
    if (x.beforeBalance === null || x.beforeBalance === undefined ||
        x.afterBalance === null || x.afterBalance === undefined) return '—';
    return '<span class="mono">' + x.beforeBalance + ' → ' + x.afterBalance + '</span>';
  }

  /** Which way the stock moved, from the warehouse's point of view. */
  function txMovement(x) {
    switch (x.type) {
      case 'INBOUND': return { label: 'Anbara qəbul', sign: 1 };
      case 'ISSUE_TO_WORKER': return { label: 'İşçiyə verildi', sign: -1 };
      case 'RETURN_TO_STOCK': return { label: 'Anbara qaytarıldı', sign: 1 };
      case 'OUT_DELIVERY': return { label: 'Çatdırılmada istifadə', sign: -1 };
      case 'DAMAGE': return { label: 'Zədələnmiş', sign: -1 };
      case 'LOSS': return { label: 'İtmiş', sign: -1 };
      case 'CORRECTION': return { label: 'Düzəliş', sign: x.signedCount >= 0 ? 1 : -1 };
      default: return { label: TX_LABEL[x.type] || x.type, sign: x.signedCount >= 0 ? 1 : -1 };
    }
  }

  /**
   * A handover writes TWO ledger rows (warehouse -N, worker +N) sharing one
   * reference. The anbar screen must not show the same event twice, so the
   * legs are folded into one row that keeps the warehouse leg's balances.
   */
  function collapseTransactions(items) {
    var map = {};
    var order = [];
    (items || []).forEach(function (x) {
      var base = String(x.reference || x.id).replace(/:cp$/, '');
      var cur = map[base];
      if (!cur) {
        cur = Object.assign({}, x, { reference: base });
        map[base] = cur;
        order.push(base);
      }
      if (!cur.workerName && x.workerName) cur.workerName = x.workerName;
      if (!cur.note && x.note) cur.note = x.note;
      if (String(x.balanceKey || '').indexOf('WAREHOUSE') === 0) {
        cur.balanceKey = x.balanceKey;
        cur.beforeBalance = x.beforeBalance;
        cur.afterBalance = x.afterBalance;
      }
    });
    return order.map(function (k) { return map[k]; });
  }

  async function pageStock(view) {
    var s = await api('GET', '/inventory/summary');
    var t = await api('GET', '/inventory/transactions?' + stockQuery(STOCK_FILTER));

    var w = s.warehouse || { filtered: 0, spring: 0, total: 0 };
    var inbound = s.inbound || { filtered: 0, spring: 0, total: 0 };
    var outbound = s.outbound || { filtered: 0, spring: 0, total: 0 };
    var issued = s.issuedToWorkers || { filtered: 0, spring: 0, total: 0 };
    var returned = s.returned || { filtered: 0, spring: 0, total: 0 };
    var workers = s.workers || [];

    var inWorkersSpring = workers.reduce(function (a, x) { return a + (x.springQty || 0); }, 0);
    var inWorkersFiltered = workers.reduce(function (a, x) { return a + (x.filteredQty || 0); }, 0);

    var html = '<div class="wh-grid">' +
      waterCard('Bulaq suyu', w.spring, 'spring') +
      waterCard('Filtr suyu', w.filtered, 'filtered') +
      waterCard('Anbarda cəmi', w.total, 'total') +
      '</div>';

    html += '<div class="cards stats-row">' +
      card('Bu gün daxil', s.todayInbound || 0, 'good') +
      card('Bu gün çıxış', s.todayOutbound || 0, 'bad') +
      card('İşçilərdə cəmi', s.inWorkersHands || 0) +
      card('Sistemdə cəmi', s.totalSystemQuantity || 0) +
      card('Zədələnmiş', s.damagedTotal || 0, 'bad') +
      card('İtmiş', s.lostTotal || 0, 'bad') +
      '</div>';

    var actions = '';
    if (isKeeper()) {
      actions += '<button class="btn btn-primary" id="wh-in">+ Anbara qəbul</button>';
    }
    actions += '<button class="btn btn-secondary" id="wh-dist">→ İşçiyə bidon ver</button>';
    if (isKeeper()) {
      actions += '<button class="btn btn-secondary" id="wh-ret">← İşçidən qaytarma</button>';
      actions += '<button class="btn btn-danger" id="wh-out">− Anbardan çıxar</button>';
    }
    html += '<div class="toolbar">' + actions + '</div>';

    html += '<div class="alert alert-info">' +
      (isKeeper()
        ? 'Bulaq və Filtr ayrı-ayrı saxlanılır. Anbar əməliyyatlarının hər biri səbəb, say və dəqiq vaxt ilə tarixçəyə yazılır; heç bir qeyd silinmir.'
        : 'Siz nəzarətçisiniz: anbar əməliyyatlarını anbardar aparır. İşçiyə bidon vermək üçün aşağıdaki düyməni istifadə edə bilərsiniz.') +
      '</div>';

    html += panel('Su növləri üzrə hərəkət', '', table(
      [
        { label: 'Su növü' }, { label: 'Anbarda', num: true }, { label: 'Daxil olub', num: true },
        { label: 'Çıxıb', num: true }, { label: 'İşçilərə verilib', num: true },
        { label: 'Qaytarılıb', num: true }, { label: 'İşçilərdə', num: true },
      ],
      [
        [waterBadge('SPRING'), String(w.spring), String(inbound.spring), String(outbound.spring),
          String(issued.spring), String(returned.spring), String(inWorkersSpring)],
        [waterBadge('FILTERED'), String(w.filtered), String(inbound.filtered), String(outbound.filtered),
          String(issued.filtered), String(returned.filtered), String(inWorkersFiltered)],
        ['<strong>Cəmi</strong>', '<strong>' + w.total + '</strong>', '<strong>' + inbound.total + '</strong>',
          '<strong>' + outbound.total + '</strong>', '<strong>' + issued.total + '</strong>',
          '<strong>' + returned.total + '</strong>', '<strong>' + (inWorkersSpring + inWorkersFiltered) + '</strong>'],
      ], 'Hələ hərəkət yoxdur.'), true);

    var workerRows = workers.map(function (x) {
      return [
        esc(x.workerName) + (x.isActive ? '' : ' <span class="badge badge-muted">deaktiv</span>'),
        workerTypeBadge(x.workerType),
        String(x.springQty || 0),
        String(x.filteredQty || 0),
        '<strong>' + (x.totalQty || 0) + '</strong>',
      ];
    });
    html += panel('İşçilərin əlində', '', table(
      [
        { label: 'Ad' }, { label: 'Növ' },
        { label: 'Bulaq', num: true }, { label: 'Filtr', num: true }, { label: 'Ümumi', num: true },
      ], workerRows, 'Hələ heç bir işçi yoxdur.'), true);

    // ---- history + filters ------------------------------------------------
    var workerOptions = '<option value="">Bütün işçilər</option>' + workers.map(function (x) {
      return '<option value="' + x.workerId + '"' + (STOCK_FILTER.workerId === x.workerId ? ' selected' : '') + '>' +
        esc(x.workerName) + '</option>';
    }).join('');

    // The anbardar list is derived from the history itself: a keeper cannot
    // call /users, and this is the only place the actor names are needed.
    var actorMap = {};
    (t.items || []).forEach(function (x) {
      if (x.createdById && x.createdByName) actorMap[x.createdById] = x.createdByName;
    });
    var actorOptions = '<option value="">Bütün anbardarlar</option>' + Object.keys(actorMap).map(function (id) {
      return '<option value="' + id + '"' + (STOCK_FILTER.createdById === id ? ' selected' : '') + '>' +
        esc(actorMap[id]) + '</option>';
    }).join('');

    var filters =
      '<div class="toolbar filter-bar">' +
        '<select id="sf-preset">' +
          '<option value="today"' + (STOCK_FILTER.preset === 'today' ? ' selected' : '') + '>Bu gün</option>' +
          '<option value="yesterday"' + (STOCK_FILTER.preset === 'yesterday' ? ' selected' : '') + '>Dünən</option>' +
          '<option value="last7days"' + (STOCK_FILTER.preset === 'last7days' ? ' selected' : '') + '>Son 7 gün</option>' +
          '<option value="last30days"' + (STOCK_FILTER.preset === 'last30days' ? ' selected' : '') + '>Son 30 gün</option>' +
          '<option value="thisMonth"' + (STOCK_FILTER.preset === 'thisMonth' ? ' selected' : '') + '>Bu ay</option>' +
          '<option value="lastMonth"' + (STOCK_FILTER.preset === 'lastMonth' ? ' selected' : '') + '>Keçən ay</option>' +
          '<option value="thisYear"' + (STOCK_FILTER.preset === 'thisYear' ? ' selected' : '') + '>Bu il</option>' +
          '<option value="all"' + (STOCK_FILTER.preset === 'all' ? ' selected' : '') + '>Bütün tarixçə</option>' +
        '</select>' +
        '<input id="sf-from" type="text" inputmode="numeric" maxlength="10" placeholder="Başlanğıc GG.AA.YYYY" value="' + esc(STOCK_FILTER.from ? date(STOCK_FILTER.from) : '') + '">' +
        '<input id="sf-to" type="text" inputmode="numeric" maxlength="10" placeholder="Son GG.AA.YYYY" value="' + esc(STOCK_FILTER.to ? date(STOCK_FILTER.to) : '') + '">' +
        '<select id="sf-water">' +
          '<option value="">Bütün su növləri</option>' +
          '<option value="SPRING"' + (STOCK_FILTER.waterType === 'SPRING' ? ' selected' : '') + '>Bulaq suyu</option>' +
          '<option value="FILTERED"' + (STOCK_FILTER.waterType === 'FILTERED' ? ' selected' : '') + '>Filtr suyu</option>' +
        '</select>' +
        '<select id="sf-type">' +
          '<option value="">Bütün əməliyyatlar</option>' +
          TX_ACTIONS.map(function (a) {
            return '<option value="' + a + '"' + (STOCK_FILTER.type === a ? ' selected' : '') + '>' +
              esc(TX_LABEL[a]) + '</option>';
          }).join('') +
        '</select>' +
        '<select id="sf-worker">' + workerOptions + '</select>' +
        '<select id="sf-actor">' + actorOptions + '</select>' +
        '<button class="btn btn-primary" id="sf-go">Filtr et</button>' +
        '<button class="btn btn-outline" id="sf-reset">Sıfırla</button>' +
      '</div>';

    var txRows = collapseTransactions(t.items).map(function (x) {
      var mv = txMovement(x);
      var qty = mv.sign * (x.bottleCount || 0);
      return [
        dateTimeFull(x.occurredAt),
        waterBadge(x.waterType),
        esc(mv.label),
        signedBadge(qty),
        warehouseTransition(x),
        esc(x.workerName || '—'),
        esc(x.createdByName || '—') +
          (x.createdByRole === 'WORKER' ? ' <span class="badge badge-muted">anbardar</span>' : ''),
        esc(x.note || '—'),
      ];
    });

    html += panel('Anbar tarixçəsi',
      '<span class="muted small">' + ((t.items || []).length ? collapseTransactions(t.items).length : 0) +
        ' əməliyyat · dəqiq saniyəyə qədər</span>',
      filters + table(
        [
          { label: 'Tarix / saat' }, { label: 'Su növü' }, { label: 'Əməliyyat' },
          { label: 'Say', num: true }, { label: 'Anbar balansı' }, { label: 'Kimə' },
          { label: 'Kim etdi' }, { label: 'Səbəb / qeyd' },
        ], txRows, 'Seçilmiş filtrlər üzrə əməliyyat yoxdur.'));

    view.innerHTML = html;

    // ---- dialogs ----------------------------------------------------------
    function openInbound() {
      // One key for this dialog: a retry after a network error reuses it, so the
      // server recognises the replay instead of adding stock twice.
      var opKey = idem('in');
      openModal('Anbara qəbul',
        '<div class="field"><span class="field-label">Su növü</span>' + waterSeg('wh-water', 'FILTERED') + '</div>' +
        '<label class="field"><span class="field-label">Bidon sayı</span>' +
          '<input id="wh-count" type="text" inputmode="numeric" placeholder="0">' +
        '</label>' +
        textField('wh-note', 'Qeyd (istəyə bağlı)', ''),
        [
          { label: 'Ləğv et', kind: 'outline' },
          { label: 'Qəbul et', kind: 'primary', onClick: function () {
            var count = parseInt($('#wh-count').value, 10) || 0;
            if (count <= 0) throw new Error('Bidon sayı müsbət tam ədəd olmalıdır.');
            var water = segValue('#wh-water');
            if (!water) throw new Error('Su növünü seçin.');
            return api('POST', '/inventory/stock-in', {
              waterType: water,
              bottleCount: count,
              note: $('#wh-note').value.trim() || undefined,
              idempotencyKey: opKey,
            }).then(function () {
              closeModal();
              toast('Anbara qəbul edildi.', 'ok');
              navigate('stock');
            });
          } },
        ]);
      bindSeg('#wh-water');
    }

    function openDistribute() {
      var opKey = idem('dist');
      var options = workers.filter(function (x) { return x.isActive; }).map(function (x) {
        return '<option value="' + x.workerId + '">' + esc(x.workerName) +
          ' — ' + esc(workerTypeLabel(x.workerType)) + '</option>';
      }).join('');
      if (!options) {
        toast('Aktiv işçi yoxdur. Əvvəlcə işçi yaradın.', 'err');
        return;
      }
      openModal('İşçiyə bidon ver',
        '<label class="field"><span class="field-label">İşçi</span>' +
          '<select id="wh-worker">' + options + '</select>' +
        '</label>' +
        '<div class="field"><span class="field-label">Su növü</span>' + waterSeg('wh-water', 'FILTERED') + '</div>' +
        '<label class="field"><span class="field-label">Bidon sayı</span>' +
          '<input id="wh-count" type="text" inputmode="numeric" placeholder="0">' +
          '<span class="field-label" style="margin-top:4px">Anbarda: Bulaq ' + w.spring + ' · Filtr ' + w.filtered + '</span>' +
        '</label>' +
        textField('wh-note', 'Qeyd (istəyə bağlı)', ''),
        [
          { label: 'Ləğv et', kind: 'outline' },
          { label: 'Ver', kind: 'primary', onClick: function () {
            var count = parseInt($('#wh-count').value, 10) || 0;
            if (count <= 0) throw new Error('Bidon sayı müsbət tam ədəd olmalıdır.');
            var water = segValue('#wh-water');
            if (!water) throw new Error('Su növünü seçin.');
            return api('POST', '/inventory/distribute', {
              workerId: $('#wh-worker').value,
              waterType: water,
              bottleCount: count,
              note: $('#wh-note').value.trim() || undefined,
              idempotencyKey: opKey,
            }).then(function (r) {
              closeModal();
              toast('İşçiyə verildi · anbarda qalan: ' + r.afterBalance + ' bidon', 'ok');
              navigate('stock');
            });
          } },
        ]);
      bindSeg('#wh-water');
    }

    function openReturn() {
      var opKey = idem('ret');
      var options = workers.filter(function (x) { return x.isActive; }).map(function (x) {
        return '<option value="' + x.workerId + '">' + esc(x.workerName) +
          ' — ' + esc(workerTypeLabel(x.workerType)) + '</option>';
      }).join('');
      if (!options) {
        toast('Aktiv işçi yoxdur.', 'err');
        return;
      }
      openModal('İşçidən qaytarma',
        '<label class="field"><span class="field-label">İşçi</span>' +
          '<select id="wh-worker">' + options + '</select>' +
        '</label>' +
        '<div class="field"><span class="field-label">Su növü</span>' + waterSeg('wh-water', 'FILTERED') + '</div>' +
        '<label class="field"><span class="field-label">Bidon sayı</span>' +
          '<input id="wh-count" type="text" inputmode="numeric" placeholder="0">' +
        '</label>' +
        textField('wh-note', 'Qeyd (istəyə bağlı)', ''),
        [
          { label: 'Ləğv et', kind: 'outline' },
          { label: 'Qaytar', kind: 'primary', onClick: function () {
            var count = parseInt($('#wh-count').value, 10) || 0;
            if (count <= 0) throw new Error('Bidon sayı müsbət tam ədəd olmalıdır.');
            var water = segValue('#wh-water');
            if (!water) throw new Error('Su növünü seçin.');
            return api('POST', '/inventory/return', {
              workerId: $('#wh-worker').value,
              waterType: water,
              bottleCount: count,
              note: $('#wh-note').value.trim() || undefined,
              idempotencyKey: opKey,
            }).then(function (r) {
              closeModal();
              toast('Qaytarma qeydə alındı · anbarda qalan: ' + r.newBalance + ' bidon', 'ok');
              navigate('stock');
            });
          } },
        ]);
      bindSeg('#wh-water');
    }

    function openWriteOff() {
      var opKey = idem('wo');
      openModal('Anbardan çıxarış',
        '<div class="field"><span class="field-label">Su növü</span>' + waterSeg('wh-water', 'FILTERED') + '</div>' +
        '<label class="field"><span class="field-label">Səbəb növü</span>' +
          '<select id="wh-wo-type">' +
            '<option value="DAMAGE">Zədələnmiş</option>' +
            '<option value="LOSS">İtmiş</option>' +
          '</select>' +
        '</label>' +
        '<label class="field"><span class="field-label">Bidon sayı</span>' +
          '<input id="wh-count" type="text" inputmode="numeric" placeholder="0">' +
        '</label>' +
        textField('wh-note', 'Səbəb (məcburi)', ''),
        [
          { label: 'Ləğv et', kind: 'outline' },
          { label: 'Çıxar', kind: 'danger', onClick: function () {
            var count = parseInt($('#wh-count').value, 10) || 0;
            if (count <= 0) throw new Error('Bidon sayı müsbət tam ədəd olmalıdır.');
            var note = $('#wh-note').value.trim();
            if (note.length < 3) throw new Error('Səbəb yazılmalıdır (ən azı 3 simvol).');
            var water = segValue('#wh-water');
            if (!water) throw new Error('Su növünü seçin.');
            return api('POST', '/inventory/warehouse-write-off', {
              type: $('#wh-wo-type').value,
              waterType: water,
              bottleCount: count,
              note: note,
              idempotencyKey: opKey,
            }).then(function () {
              closeModal();
              toast('Anbardan çıxarış qeydə alındı.', 'ok');
              navigate('stock');
            });
          } },
        ]);
      bindSeg('#wh-water');
    }

    if ($('#wh-in')) $('#wh-in').addEventListener('click', openInbound);
    if ($('#wh-dist')) $('#wh-dist').addEventListener('click', openDistribute);
    if ($('#wh-ret')) $('#wh-ret').addEventListener('click', openReturn);
    if ($('#wh-out')) $('#wh-out').addEventListener('click', openWriteOff);

    $('#sf-go').addEventListener('click', function () {
      try {
        var fromText = $('#sf-from').value.trim();
        var toText = $('#sf-to').value.trim();
        var fromIso = parseAzerbaijaniDate(fromText);
        var toIso = parseAzerbaijaniDate(toText);
        if (fromText && !fromIso) throw new Error('Başlanğıc tarix GG.AA.YYYY formatında olmalıdır.');
        if (toText && !toIso) throw new Error('Son tarix GG.AA.YYYY formatında olmalıdır.');
        if (fromIso && toIso && fromIso > toIso) {
          throw new Error('Başlanğıc tarix son tarixdən böyük ola bilməz.');
        }
        STOCK_FILTER = {
          preset: $('#sf-preset').value,
          from: fromIso,
          to: toIso,
          waterType: $('#sf-water').value,
          type: $('#sf-type').value,
          workerId: $('#sf-worker').value,
          createdById: $('#sf-actor').value,
        };
        navigate('stock');
      } catch (e) {
        toast(e.message, 'err');
      }
    });

    $('#sf-reset').addEventListener('click', function () {
      STOCK_FILTER = {
        preset: 'last30days', from: '', to: '', waterType: '',
        type: '', workerId: '', createdById: '',
      };
      navigate('stock');
    });
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

      '<label class="field" id="n-cphone-wrap"><span class="field-label">Telefon</span>' +
        '<input id="n-cphone" placeholder="Müştəri telefonu" /></label>' +

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
      dateField(),
      [
        { label: 'Ləğv et', kind: 'outline' },
        { label: 'Yadda saxla', kind: 'primary', onClick: function () {
          var count = parseInt($('#n-count').value, 10) || 0;
          if (!count || count < 1) throw new Error('Bidon sayı ən azı 1 olmalıdır.');

          if (dest === 'COMPANY') {
            if (!$('#n-company').value || !$('#n-office').value) {
              throw new Error('Şirkət və ofis seçilməlidir.');
            }
          } else {
            if ($('#n-addr').value.trim().length < 3) {
              throw new Error('Evə çatdırılmada ünvan yazılmalıdır.');
            }
            var pickedCheck = $('#n-picked').dataset.id;
            var custNameCheck = $('#n-name').value.trim() || $('#n-search').value.trim();
            if (!pickedCheck && custNameCheck.length < 2) {
              throw new Error('Müştərinin adını yazın və ya axtarışdan seçin.');
            }
          }

          var picked = dest === 'COMPANY' ? '' : ($('#n-picked').dataset.id || '');
          var custName = dest === 'COMPANY'
            ? undefined
            : (picked ? undefined : ($('#n-name').value.trim() || $('#n-search').value.trim() || undefined));

          // The field reads DD.MM.YYYY. An empty or impossible one is refused
          // here rather than sent on, because a delivery filed under a month that
          // does not exist is worse than no delivery.
          var day = parseAzerbaijaniDate($('#n-date').value);
          if (!day) throw new Error('Tarix GG.AA.İLİ formatında yazılmalıdır (məsələn ' + date(dayOffsetIso(0)) + ').');
          if (day > dayOffsetIso(0)) throw new Error('Çatdırılma tarixi gələcəkdə ola bilməz.');

          return api('POST', '/deliveries', {
            customerId: picked || undefined,
            customerName: custName,
            contactPhone: dest === 'HOME' ? ($('#n-cphone').value.trim() || undefined) : undefined,
            waterType: currentWater(),
            destinationType: dest,
            companyId: dest === 'COMPANY' ? ($('#n-company').value || undefined) : undefined,
            officeId: dest === 'COMPANY' ? ($('#n-office').value || undefined) : undefined,
            address: dest === 'HOME' ? $('#n-addr').value.trim() : undefined,
            bottleCount: count,
            deliveredAt: day + 'T12:00:00.000Z',
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

    // One tap for today, or for either of the two days before it. The chosen
    // button is filled, so the date on screen is never a guess.
    function setDay(iso) {
      $('#n-date').value = date(iso);
      if ($('#n-date-picker')) $('#n-date-picker').value = iso;
      $$('#n-day-chips .btn').forEach(function (x) {
        x.classList.toggle('is-on', x.dataset.day === iso);
      });
      $('#n-date-note').textContent = iso === dayOffsetIso(0)
        ? 'Bu gün'
        : dayRelativeName(iso) + ' · ' + date(iso);
    }
    $('#n-day-chips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-day]');
      if (!b) return;
      setDay(b.dataset.day);
    });
    $('#n-cal-btn').addEventListener('click', function () {
      var picker = $('#n-date-picker');
      if (!picker) return;
      if (typeof picker.showPicker === 'function') {
        picker.showPicker();
      } else {
        picker.focus();
      }
    });
    $('#n-date-picker').addEventListener('change', function () {
      if (this.value) setDay(this.value);
    });
    $('#n-date').addEventListener('input', function () {
      var iso = parseAzerbaijaniDate(this.value);
      if (iso && $('#n-date-picker')) $('#n-date-picker').value = iso;
      $$('#n-day-chips .btn').forEach(function (x) {
        x.classList.toggle('is-on', iso !== '' && x.dataset.day === iso);
      });
      $('#n-date-note').textContent = iso
        ? (iso === dayOffsetIso(0) ? 'Bu gün · ' + date(iso) : dayRelativeName(iso) + ' · ' + date(iso))
        : 'GG.AA.İLİ formatında yaz';
    });
    setDay(dayOffsetIso(0));

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
                    '" data-caddr="' + esc(c.address || '') + '" data-cphone="' + esc(c.phone || '') +
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
                // Avtomatik doldur: seçilmiş müştərinin ünvan və telefonu forma gedir.
                if (a.dataset.caddr) $('#n-addr').value = a.dataset.caddr;
                if (a.dataset.cphone) {
                  var ph = $('#n-cphone');
                  if (ph) ph.value = a.dataset.cphone;
                }
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

  // ------------------------------------------------------ notifications --
  /**
   * Admin-only warehouse notifications.
   *
   * Every row is written server-side at the moment of the operation and carries
   * the actor, water type, count, the balance before and after, the exact time
   * and any reason. It can be marked read, never deleted.
   */
  async function pageNotifications(view) {
    var d = await api('GET', '/notifications?pageSize=100');
    var items = d.items || [];

    var rows = items.map(function (n) {
      var mv = txMovement({ type: n.action, signedCount: 1 });
      var qty = mv.sign * (n.bottleCount || 0);
      return [
        n.read ? '<span class="badge badge-muted">oxunub</span>' : '<span class="badge badge-info">yeni</span>',
        dateTimeFull(n.createdAt),
        esc(n.actorName || '—'),
        esc(TX_LABEL[n.action] || mv.label || n.action),
        waterBadge(n.waterType),
        signedBadge(qty),
        '<span class="mono">' + n.beforeBalance + ' → ' + n.afterBalance + '</span>',
        esc(n.note || '—'),
        n.read ? '—' : '<button class="btn btn-secondary btn-sm" data-read="' + n.id + '">Oxundu</button>',
      ];
    });

    view.innerHTML =
      '<div class="alert alert-info">Hər anbar əməliyyatı avtomatik bildiriş yaradır. ' +
        'Bildirişlər yalnız administratora görünür və silinə bilməz.</div>' +
      panel('Bildirişlər (' + (d.total || 0) + ')',
        '<button class="btn btn-outline btn-sm" id="nt-readall">Hamısını oxundu et</button>',
        table([
          { label: '' }, { label: 'Tarix / saat' }, { label: 'Kim' }, { label: 'Əməliyyat' },
          { label: 'Su növü' }, { label: 'Say', num: true }, { label: 'Balans' },
          { label: 'Səbəb / qeyd' }, { label: '', cls: 'actions' },
        ], rows, 'Hələ bildiriş yoxdur.'), true);

    $('#nt-readall').addEventListener('click', async function () {
      await api('PATCH', '/notifications/read-all', {});
      toast('Bütün bildirişlər oxundu.', 'ok');
      refreshNotifBadge();
      navigate('notifications');
    });

    $$('#view button[data-read]').forEach(function (b) {
      b.addEventListener('click', async function () {
        await api('PATCH', '/notifications/' + b.dataset.read + '/read', {});
        refreshNotifBadge();
        navigate('notifications');
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
