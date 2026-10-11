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

  /** Dates render as DD.MM.YYYY in Baku local time (UTC+4). */
  function date(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return String(d.getUTCDate()).padStart(2, '0') + '.' +
           String(d.getUTCMonth() + 1).padStart(2, '0') + '.' +
           d.getUTCFullYear();
  }

  function dateTime(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return date(v) + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' +
           String(d.getUTCMinutes()).padStart(2, '0');
  }

  /** Today as YYYY-MM-DD for date inputs (UTC+4 calendar day). */
  function todayInput() {
    var now = new Date(Date.now() + 4 * 3600 * 1000);
    return now.toISOString().slice(0, 10);
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

  var TX_LABEL = {
    INBOUND: 'Anbara qəbul',
    ISSUE_TO_WORKER: 'İşçiyə təhvil',
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
    render(page, view).catch(function (e) {
      view.innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>';
    });
  }

  window.addEventListener('hashchange', function () {
    var p = location.hash.slice(1);
    if (p && p !== state.route) navigate(p);
  });

  // ------------------------------------------------------------ modal ----
  function openModal(title, bodyHtml, footButtons) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    var foot = $('#modal-foot');
    foot.innerHTML = '';
    (footButtons || [{ label: 'Bağla', kind: 'outline' }]).forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn btn-' + (b.kind || 'outline');
      btn.textContent = b.label;
      btn.addEventListener('click', function () {
        if (b.onClick) {
          btn.disabled = true;
          Promise.resolve(b.onClick(btn)).catch(function () {}).then(function () {
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

    view.innerHTML =
      '<div class="cards">' +
        card('Əlimdəki bidonlar', String(s.quantity || 0), 'good') +
        card('Son yenilənmə', dateTime(s.updatedAt)) +
      '</div>' +
      '<div class="toolbar">' +
        '<button class="btn btn-primary" id="mb-in">+ Anbara qəbul (yeni gələn)</button>' +
        '<button class="btn btn-secondary" id="mb-back">↩ Anbara qaytar</button>' +
        '<button class="btn btn-outline" id="mb-wo">Zədələnmiş / itmiş</button>' +
      '</div>' +
      '<div class="alert alert-info">Anbara qəbul — yeni gələn bidonların sayını yaz. Admin dərhal görür.</div>' +
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
      openModal(title,
        typePicker +
        moneyField('b-count', 'Bidon sayı', '') +
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
            else if (mode === 'return') call = api('POST', '/inventory/return', body);
            else call = api('POST', '/inventory/write-off', Object.assign({ type: $('#b-type').value }, body));
            return call.then(function (r) {
              closeModal();
              toast(title + ' · yeni qalıq: ' + r.newBalance, 'ok');
              navigate('mystock');
            });
          } },
        ]);
    };

    $('#mb-in').addEventListener('click', function () { stockDialog('Anbara qəbul', 'in', false); });
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
      textField('w-user', 'İstifadəçi adı (latın)', '') +
      textField('w-phone', 'Telefon', '', { type: 'tel' }) +
      textField('w-email', 'E-mail (istəyə bağlı)', '', { type: 'email' }) +
      '<div class="alert alert-info">Şifrə boş buraxsanız, sistem özü güclü şifrə yaradacaq və bir dəfə göstərəcək.</div>',
      [
        { label: 'Ləğv et', kind: 'outline' },
        {
          label: 'Yarat',
          kind: 'primary',
          onClick: async function () {
            var body = {
              fullName: $('#w-name').value.trim(),
              username: $('#w-user').value.trim(),
              phone: $('#w-phone').value.trim() || undefined,
              email: $('#w-email').value.trim() || undefined,
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
  }

  // ------------------------------------------------------------- stock --
  async function pageStock(view) {
    var s = await api('GET', '/inventory/summary');
    var t = await api('GET', '/inventory/transactions?pageSize=25');

    var html = '<div class="cards">' +
      card('Anbarda', s.warehouseQuantity || 0) +
      card('İşçilərdə', s.inWorkersHands || 0) +
      card('Sistemdə cəmi', s.totalSystemQuantity || 0) +
      card('Bu gün daxil', s.todayInbound || 0, 'good') +
      card('Bu gün çıxış', s.todayOutbound || 0, 'bad') +
      card('Zədələnmiş', s.damagedTotal || 0, 'bad') +
      card('İtmiş', s.lostTotal || 0, 'bad') +
      '</div>';

    html += '<div class="toolbar">' +
      '<button class="btn btn-primary" id="btn-in">+ Anbara qəbul</button>' +
      '<button class="btn btn-secondary" id="btn-out">→ İşçiyə təhvil</button>' +
      '<button class="btn btn-outline" id="btn-wo">Zədələnmiş / itmiş</button>' +
      '</div>';

    var workerRows = (s.workers || []).map(function (w) {
      return [esc(w.workerName), esc(w.username),
        w.isActive ? '' : '<span class="badge badge-muted">deaktiv</span>',
        w.quantity === 0 ? '<span class="badge badge-unpaid">0</span>' : String(w.quantity)];
    });
    html += panel('İşçilərin əlində', '', table(
      [{ label: 'Ad' }, { label: 'İstifadəçi adı' }, { label: 'Vəziyyət' }, { label: 'Bidon', num: true }],
      workerRows, 'Hələ heç bir işçi yoxdur.'), true);

    var txRows = (t.items || []).map(function (x) {
      var by = x.createdByName
        ? esc(x.createdByName) + (x.createdByRole === 'WORKER' ? ' <span class="badge badge-muted">işçi</span>' : '')
        : '—';
      return [
        esc(TX_LABEL[x.type] || x.type),
        '<span class="' + (x.signedCount > 0 ? 'badge badge-paid' : 'badge badge-unpaid') + '">' +
          (x.signedCount > 0 ? '+' : '') + x.signedCount + '</span>',
        dateTime(x.occurredAt),
        by,
        esc(x.note || '—'),
      ];
    });
    html += panel('İnventar tarixçəsi', '', table(
      [{ label: 'Əməliyyat' }, { label: 'Say' }, { label: 'Tarix' }, { label: 'Kim yazdı' }, { label: 'Qeyd' }],
      txRows, 'Hələ əməliyyat yoxdur.'), true);

    view.innerHTML = html;

    $('#btn-in').addEventListener('click', function () {
      openModal('Anbara qəbul',
        moneyField('s-count', 'Bidon sayı', '') +
        textField('s-note', 'Qeyd (istəyə bağlı)', ''),
        [
          { label: 'Ləğv et', kind: 'outline' },
          { label: 'Qəbul et', kind: 'primary', onClick: function () {
            return api('POST', '/inventory/stock-in', {
              bottleCount: parseInt($('#s-count').value, 10) || 0,
              note: $('#s-note').value.trim() || undefined,
              idempotencyKey: idem('in'),
            }).then(function (r) {
              closeModal();
              toast('Anbar: ' + r.newBalance + ' bidon.', 'ok');
              navigate('stock');
            });
          } },
        ]);
    });

    $('#btn-out').addEventListener('click', function () {
      var active = (s.workers || []).filter(function (w) { return w.isActive; });
      if (!active.length) {
        openModal('İşçiyə təhvil',
          '<div class="alert alert-error">Hələ aktiv işçi yoxdur. Əvvəlcə "İşçilər" bölməsindən işçi yaradın.</div>',
          [{ label: 'Bağla', kind: 'primary' }]);
        return;
      }
      openModal('İşçiyə təhvil',
        '<label class="field"><span class="field-label">İşçi</span><select id="s-worker">' +
        active.map(function (w) {
          return '<option value="' + w.workerId + '">' + esc(w.workerName) + ' (' + w.quantity + ')</option>';
        }).join('') + '</select></label>' +
        moneyField('s-count', 'Bidon sayı', '', 'Anbarda ' + s.warehouseQuantity + ' bidon var') +
        textField('s-note', 'Qeyd (istəyə bağlı)', ''),
        [
          { label: 'Ləğv et', kind: 'outline' },
          { label: 'Təhvil et', kind: 'primary', onClick: function () {
            return api('POST', '/inventory/issue', {
              workerId: $('#s-worker').value,
              bottleCount: parseInt($('#s-count').value, 10) || 0,
              note: $('#s-note').value.trim() || undefined,
              idempotencyKey: idem('out'),
            }).then(function (r) {
              closeModal();
              toast('Təhvil edildi. Yeni qalıq: ' + r.newBalance, 'ok');
              navigate('stock');
            });
          } },
        ]);
    });

    $('#btn-wo').addEventListener('click', function () {
      openModal('Zədələnmiş / itmiş',
        '<label class="field"><span class="field-label">Növ</span><select id="s-type">' +
        '<option value="DAMAGE">Zədələnmiş</option><option value="LOSS">İtmiş</option>' +
        '</select></label>' +
        moneyField('s-count', 'Bidon sayı', '') +
        textField('s-note', 'Səbəb', ''),
        [
          { label: 'Ləğv et', kind: 'outline' },
          { label: 'Qeydə al', kind: 'primary', onClick: function () {
            return api('POST', '/inventory/write-off', {
              type: $('#s-type').value,
              bottleCount: parseInt($('#s-count').value, 10) || 0,
              note: $('#s-note').value.trim(),
              idempotencyKey: idem('wo'),
            }).then(function (r) {
              closeModal();
              toast('Qeydə alındı. Yeni qalıq: ' + r.newBalance, 'ok');
              navigate('stock');
            });
          } },
        ]);
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
        '<input id="del-s" class="grow" placeholder="Müştəri və ya ünvan" value="' + esc(s) + '" />' +
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
          { label: 'Tarix' }, { label: 'Müştəri' }, { label: 'İşçi' },
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

    openModal('Çatdırılma · ' + date(d.deliveredAt),
      '<dl class="kv">' +
        '<dt>Müştəri</dt><dd>' + esc(d.customerName || '—') + '</dd>' +
        '<dt>İşçi</dt><dd>' + esc(d.workerName || '—') + '</dd>' +
        '<dt>Ünvan</dt><dd>' + esc(d.address) + '</dd>' +
        '<dt>Bidon sayı</dt><dd>' + d.bottleCount + '</dd>' +
        '<dt>Bir bidon</dt><dd>' + money(d.unitPrice) + ' AZN</dd>' +
        '<dt>Ümumi</dt><dd>' + money(d.totalAmount) + ' AZN</dd>' +
        '<dt>Ödənilən</dt><dd>' + money(d.paidAmount) + ' AZN</dd>' +
        '<dt>Qalıq borc</dt><dd>' + money(d.debtAmount) + ' AZN</dd>' +
        '<dt>Status</dt><dd>' + statusBadge(d.status) + '</dd>' +
        (d.note ? '<dt>Qeyd</dt><dd>' + esc(d.note) + '</dd>' : '') +
      '</dl>' +
      '<div class="mt">' + table([
        { label: 'Tarix' }, { label: 'Məbləğ', num: true }, { label: 'Üsul' }, { label: '' }, { label: '', cls: 'actions' },
      ], rows, 'Ödəniş yoxdur.') + '</div>',
      [
        { label: 'Bağla', kind: 'outline' },
        ...(d.status === 'CANCELLED' ? [] : [{ label: '+ Ödəniş', kind: 'primary', onClick: function () {
          closeModal();
          paymentForm(d);
        } }]),
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

  function paymentForm(d) {
    var remaining = parseFloat(d.debtAmount) || 0;
    openModal('Ödəniş qeyd et',
      '<div class="alert alert-info">Qalıq borc: <strong>' + money(remaining) + ' AZN</strong></div>' +
      moneyField('p-amount', 'Məbləğ', remaining ? String(remaining) : '', 'Boş buraxsanız qalıq borc yazılır') +
      '<label class="field"><span class="field-label">Üsul</span><select id="p-method">' +
        Object.keys(METHOD).map(function (k) {
          return '<option value="' + k + '">' + esc(METHOD[k]) + '</option>';
        }).join('') + '</select></label>' +
      textField('p-note', 'Qeyd (istəyə bağlı)', ''),
      [
        { label: 'Ləğv et', kind: 'outline' },
        { label: 'Qeyd et', kind: 'primary', onClick: function () {
          var v = $('#p-amount').value.trim();
          return api('POST', '/payments', {
            deliveryId: d.id,
            amount: v === '' ? undefined : v,
            method: $('#p-method').value,
            note: $('#p-note').value.trim() || undefined,
            idempotencyKey: idem('pay'),
          }).then(function () {
            closeModal();
            toast('Ödəniş qeydə alındı.', 'ok');
            navigate('deliveries');
          });
        } },
      ]);
  }

  function newDeliveryForm() {
    openModal('Yeni çatdırılma',
      '<label class="field"><span class="field-label">Müştəri (ad və ya telefon)</span>' +
        '<input id="n-search" placeholder="Axtar…" /></label>' +
      '<div id="n-results" class="small"></div>' +
      '<div id="n-picked" class="alert alert-ok" hidden></div>' +
      '<label class="field" id="n-manual-wrap"><span class="field-label">Və ya yeni müştəri adı</span>' +
        '<input id="n-name" /></label>' +
      textField('n-addr', 'Ünvan', '', { multiline: true }) +
      moneyField('n-count', 'Bidon sayı', '') +
      moneyField('n-price', 'Bir bidonun qiyməti', '2.00') +
      moneyField('n-paid', 'Ödənilən məbləğ', '0.00', '0 yazsanız borc qalır') +
      '<label class="field"><span class="field-label">Ödəniş üsulu</span><select id="n-method">' +
        Object.keys(METHOD).map(function (k) {
          return '<option value="' + k + '">' + esc(METHOD[k]) + '</option>';
        }).join('') + '</select></label>' +
      textField('n-date', 'Tarix', todayInput(), { type: 'date' }),
      [
        { label: 'Ləğv et', kind: 'outline' },
        { label: 'Yadda saxla', kind: 'primary', onClick: function () {
          var picked = $('#n-picked').dataset.id;
          return api('POST', '/deliveries', {
            customerId: picked || undefined,
            customerName: picked ? undefined : $('#n-name').value.trim(),
            address: $('#n-addr').value.trim(),
            bottleCount: parseInt($('#n-count').value, 10) || 0,
            unitPrice: $('#n-price').value.trim(),
            paidAmount: $('#n-paid').value.trim() || '0',
            paymentMethod: $('#n-method').value,
            deliveredAt: $('#n-date').value + 'T12:00:00.000Z',
            idempotencyKey: idem('d'),
          }).then(function () {
            closeModal();
            toast('Çatdırılma qeydə alındı.', 'ok');
            navigate('deliveries');
          });
        } },
      ]);

    var pickedId = '';
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
                pickedId = a.dataset.cid;
                $('#n-picked').hidden = false;
                $('#n-picked').dataset.id = pickedId;
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
          textField('a-note', 'Səbəb', ''),
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

    view.innerHTML =
      // Monthly report gets its own block: it is the report the owner asks for
      // most often and it should never be hidden behind a date range.
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
