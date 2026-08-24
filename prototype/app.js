/* =========================================================================
 * Expiration Tracker — Interaction Prototype
 * PROTOTYPE ONLY. Not production frontend architecture (see README.md).
 *
 * Deterministic, in-memory fake backend + hash router + 17 surface renderers
 * (SURF-001..SURF-017) + a Prototype Scenario Control bar (clearly marked
 * PROTOTYPE-ONLY throughout, never rendered as part of an evaluated surface).
 *
 * Design rules enforced by this file (see docs/frontend/interface-interaction-
 * prototype.md for the full rationale — this is a summary of the constraints
 * a reviewer should be able to verify by reading the code):
 *  - No Math.random()/Date.now() — a fixed TODAY constant drives all date math,
 *    so every scenario is exactly reproducible.
 *  - Navigation between surfaces always goes through navigate(hash), which
 *    changes location.hash. In-place state changes on the SAME surface
 *    (form input, submit, confirm) call render() directly without touching
 *    location.hash. This distinction is what lets §37 (re-entry) be modeled
 *    honestly: leaving-and-returning via navigate() to the Document Context
 *    surface deliberately forgets ephemeral "just uploaded" knowledge,
 *    because BLOCKER-A means that knowledge was never really persisted
 *    anywhere the UI can query — see resetDocEphemeralOnFreshEntry().
 *  - Nothing here calls a real network API. All "backend" state lives in DB.
 * ========================================================================= */
(function () {
  'use strict';

  var TODAY = '2026-08-23'; // fixed clock — never Date.now()

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '/' + mm + '/' + d.getFullYear();
  }
  function daysUntil(iso) {
    var ms = new Date(iso + 'T00:00:00') - new Date(TODAY + 'T00:00:00');
    return Math.round(ms / 86400000);
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function announce(msg) {
    var el = document.getElementById('live-region');
    el.textContent = '';
    // re-trigger for screen readers even if the text is identical to before
    window.setTimeout(function () { el.textContent = msg; }, 30);
  }
  function uid(prefix) {
    DB._seq = (DB._seq || 0) + 1;
    return prefix + '-' + DB._seq;
  }
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ---------------------------------------------------------------------
  // fake backend (in-memory DB) — resettable, deterministic seed
  // ---------------------------------------------------------------------
  var DB, FLAGS, SESSION;
  var actions = {}; // populated throughout the file as `actions.xxx = ...`; must exist before first use

  function seedDB() {
    DB = { _seq: 0 };
    DB.items = [
      { id: 'item-1', name: 'Apólice de Seguro', category: 'Seguro', dueDate: '2026-08-20', status: 'ACTIVE', assignee: 'Financeiro', version: 1 },
      { id: 'item-2', name: 'Alvará de Funcionamento', category: 'Licença', dueDate: '2026-08-18', status: 'ACTIVE', assignee: 'Operações', version: 1 },
      { id: 'item-3', name: 'Certificado Digital A1', category: 'Certificado', dueDate: '2026-08-30', status: 'ACTIVE', assignee: 'Financeiro', version: 1 },
      { id: 'item-4', name: 'Contrato de Locação', category: 'Contrato', dueDate: '2026-12-15', status: 'ACTIVE', assignee: 'Jurídico', version: 1 },
      { id: 'item-5', name: 'Licença Ambiental', category: 'Licença', dueDate: '2027-03-02', status: 'ACTIVE', assignee: 'Operações', version: 1 }
    ];
    DB.subjects = [
      { id: 'subj-1', name: 'Transportadora Silva Ltda.', type: 'Fornecedor' },
      { id: 'subj-2', name: 'Contabilidade Martins', type: 'Fornecedor' },
      { id: 'subj-3', name: 'João Pereira (Corretor)', type: 'Fornecedor' }
    ];
    DB.requirements = [
      { id: 'req-1', subjectId: 'subj-1', name: 'Apólice de Seguro RC', status: 'MISSING', linkedItemId: null },
      { id: 'req-2', subjectId: 'subj-1', name: 'Certidão Negativa de Débitos', status: 'MISSING', linkedItemId: null },
      { id: 'req-3', subjectId: 'subj-1', name: 'Alvará de Funcionamento', status: 'SATISFIED', linkedItemId: 'item-2' },
      { id: 'req-4', subjectId: 'subj-2', name: 'Contrato Social', status: 'SATISFIED', linkedItemId: 'item-4' },
      { id: 'req-5', subjectId: 'subj-3', name: 'Certidão de Antecedentes', status: 'MISSING', linkedItemId: null }
    ];
    DB.documentRequests = [
      { id: 'dr-1', requirementId: 'req-1', recipient: 'contato@transportadorasilva.com.br', status: 'REQUESTED', sentAt: '2026-08-15', deadline: '2026-08-29', submission: null }
    ];
    DB.importJobs = {};
    DB.guestTokens = {
      'tok-valid': { documentRequestId: 'dr-1', requirementName: 'Apólice de Seguro RC', deadline: '2026-08-29', allowedTypes: 'PDF, JPEG, PNG', maxBytes: '10 MB', revoked: false, expired: false },
      'tok-expired': { documentRequestId: 'dr-1', requirementName: 'Apólice de Seguro RC', deadline: '2026-08-01', allowedTypes: 'PDF, JPEG, PNG', maxBytes: '10 MB', revoked: false, expired: true },
      'tok-revoked': { documentRequestId: 'dr-1', requirementName: 'Apólice de Seguro RC', deadline: '2026-08-29', allowedTypes: 'PDF, JPEG, PNG', maxBytes: '10 MB', revoked: true, expired: false }
      // 'tok-invalid' and 'tok-notfound' are deliberately absent from this map —
      // see resolveGuestToken(): missing key converges to the same external state
      // as expired/revoked, never a distinct message (anti-enumeration, §32).
    };
    DB.settings = { emailEnabled: true, locale: 'pt-BR', quietStart: '20:00', quietEnd: '08:00', deliveryPreference: 'auto' };
    DB._seq = 100; // seeded ids are item-1..5/subj-1..3/req-1..5/dr-1 — start uid() well clear of them
  }

  function resetFlags() {
    FLAGS = {
      overviewLoadError: false,
      collectionLoadError: false,
      createOutcome: null,   // null(success) | 'unknown'
      renewOutcome: null,    // null(success) | 'unknown'
      forceConflictOnNextMutation: false,
      uploadOutcome: null,   // null(success) | 'networkFail'
      guestUploadOutcome: null, // null(success) | 'networkFail'
      importOutcome: null    // null(success) | 'parseFailed' | 'unknown'
    };
  }

  function resetAll() {
    seedDB();
    resetFlags();
    SESSION = { authenticated: true, pendingReturn: null };
    docSessionEntry = {};
    location.hash = '#/overview';
    announce('Estado do protótipo reiniciado.');
    render();
  }

  // ---------------------------------------------------------------------
  // domain helpers
  // ---------------------------------------------------------------------
  function findItem(id) { return DB.items.filter(function (i) { return i.id === id; })[0]; }
  function findSubject(id) { return DB.subjects.filter(function (s) { return s.id === id; })[0]; }
  function findRequirement(id) { return DB.requirements.filter(function (r) { return r.id === id; })[0]; }
  function findDocRequest(id) { return DB.documentRequests.filter(function (r) { return r.id === id; })[0]; }
  function requirementsOf(subjectId) { return DB.requirements.filter(function (r) { return r.subjectId === subjectId; }); }
  function pendingCount(subjectId) { return requirementsOf(subjectId).filter(function (r) { return r.status === 'MISSING'; }).length; }
  function linkedCount(subjectId) { return requirementsOf(subjectId).filter(function (r) { return r.status === 'SATISFIED'; }).length; }

  function itemStatusLabel(item) {
    if (item.status === 'ARCHIVED') return { text: 'ARQUIVADO', cls: '' };
    if (item.status === 'RENEWED') return { text: 'RENOVADO', cls: '' };
    var d = daysUntil(item.dueDate);
    if (d < 0) return { text: 'VENCIDO', cls: 'status-overdue' };
    if (d <= 7) return { text: 'VENCE EM ' + d + (d === 1 ? ' DIA' : ' DIAS'), cls: 'status-soon' };
    return { text: 'ATIVO', cls: '' };
  }
  function statusLabelHtml(item) {
    var s = itemStatusLabel(item);
    return '<span class="status-label ' + s.cls + '">[' + esc(s.text) + ']</span>';
  }

  // ---------------------------------------------------------------------
  // router
  // ---------------------------------------------------------------------
  // Literal routes (e.g. /items/new) are matched before parameterized ones
  // (e.g. /items/:id) regardless of registration order — otherwise a dynamic
  // segment would shadow a literal sibling (":id" happily captures "new").
  var routesLiteral = [], routesParam = [];
  function route(pattern, handler) {
    var re = new RegExp('^' + pattern.replace(/:[^/]+/g, '([^/?]+)') + '(?:\\?(.*))?$');
    (pattern.indexOf(':') === -1 ? routesLiteral : routesParam).push({ re: re, handler: handler, pattern: pattern });
  }

  function currentHash() { return (location.hash || '#/overview').replace(/^#/, ''); }

  function navigate(hash) { location.hash = hash; } // triggers hashchange -> fresh entry semantics

  var lastRenderedHash = null;
  function render() {
    var hash = currentHash();
    var freshEntry = hash !== lastRenderedHash;
    lastRenderedHash = hash;

    if (freshEntry) onFreshEntry(hash);

    var app = document.getElementById('app');
    app.innerHTML = '';

    if (!SESSION.authenticated && !/^\/guest\//.test(hash) && !/^\/session-expired/.test(hash)) {
      hash = '/session-expired';
    }

    var ordered = routesLiteral.concat(routesParam); // literal routes always win over parameterized siblings
    for (var i = 0; i < ordered.length; i++) {
      var m = ordered[i].re.exec(hash);
      if (m) {
        var params = m.slice(1, -1);
        var query = parseQuery(m[m.length - 1]);
        app.innerHTML = ordered[i].handler.apply(null, params.concat([query]));
        afterRender(app);
        renderScenarioButtons();
        return;
      }
    }
    app.innerHTML = notFoundSurface(hash);
    afterRender(app);
  }

  function parseQuery(raw) {
    var out = {};
    if (!raw) return out;
    raw.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }

  function afterRender(app) {
    app.focus();
    qsa('[data-action]', app).forEach(function (el) {
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        var action = el.getAttribute('data-action');
        var handler = actions[action];
        if (handler) handler(el);
      });
    });
    qsa('form[data-form]', app).forEach(function (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var handler = actions[form.getAttribute('data-form')];
        if (handler) handler(form);
      });
    });
    qsa('[data-onchange]', app).forEach(function (el) {
      el.addEventListener('change', function () {
        var handler = actions[el.getAttribute('data-onchange')];
        if (handler) handler(el);
      });
    });
  }

  // ---- fresh-entry side effects (this is what makes re-entry honest, §37) ----
  var docSessionEntry = {}; // itemId -> {state} kept ONLY across in-place re-renders
  function onFreshEntry(hash) {
    var m = /^\/items\/([^/]+)\/document/.exec(hash);
    if (!m) {
      // leaving the document surface entirely forgets ephemeral upload knowledge —
      // BLOCKER-A means this was never really observable/persisted from the UI's
      // point of view, so a genuine fresh visit must not "remember" it either.
      docSessionEntry = {};
    } else if (!docSessionEntry[m[1]] || docSessionEntry.__lastHash !== hash) {
      docSessionEntry = {};
      docSessionEntry.__lastHash = hash;
    }
  }

  function notFoundSurface(hash) {
    return shell('SUPERFÍCIE NÃO ENCONTRADA', '', '<p>Rota de protótipo desconhecida: <code>' + esc(hash) + '</code></p>' +
      '<div class="actions"><a class="btn" href="#/overview">Voltar à Overview</a></div>', {});
  }

  // ---------------------------------------------------------------------
  // shell / structural chrome shared by all authenticated surfaces
  // ---------------------------------------------------------------------
  function structuralNav(current) {
    function link(hash, label, key) {
      var cls = current === key ? ' class="nav-current"' : '';
      return '<a href="#' + hash + '"' + cls + '>' + label + '</a>';
    }
    return '<nav class="nav-structural" aria-label="Navegação estrutural (forma final não decidida)">' +
      link('/overview', 'Overview', 'overview') +
      link('/items', 'Vencimentos', 'items') +
      link('/subjects', 'Fornecedores', 'subjects') +
      link('/requests-collection', 'Solicitações', 'requests') +
      '<span class="nav-utility">' + link('/settings', 'Configurações', 'settings') + '</span>' +
      '</nav>';
  }

  function shell(title, originHtml, bodyHtml, opts) {
    opts = opts || {};
    var nav = opts.guest || opts.noNav ? '' : structuralNav(opts.navKey);
    var cls = 'surface' + (opts.guest ? ' guest-shell' : '');
    return nav +
      '<section class="' + cls + '">' +
      '<h1>' + esc(title) + '</h1>' +
      (originHtml ? '<div class="origin">' + originHtml + '</div>' : '') +
      bodyHtml +
      (opts.a11y ? '<div class="a11y-note">A11y: ' + opts.a11y + '</div>' : '') +
      '</section>';
  }

  function blockedBlock(tag, text) {
    return '<div class="blocked-block"><span class="blocked-tag">[BLOQUEADO: ' + esc(tag) + ']</span>' + text + '</div>';
  }

  function feedback(kind, symbol, text) {
    return '<div class="feedback feedback-' + kind + '">' + symbol + ' ' + text + '</div>';
  }

  // =======================================================================
  // SURF-001 — Overview
  // =======================================================================
  route('/overview', function (q) {
    if (FLAGS.overviewLoadError) {
      return shell('Vencimentos — Visão Geral', '', feedback('failed', '✕', 'Não foi possível carregar seus vencimentos.') +
        '<div class="actions"><button data-action="retryOverview" class="btn">Tentar novamente</button></div>',
        { navKey: 'overview', a11y: 'erro anunciado via região ao vivo; distinto estruturalmente do estado "sem pendências".' });
    }
    var active = DB.items.filter(function (i) { return i.status === 'ACTIVE'; });
    if (active.length === 0) {
      return shell('Vencimentos — Visão Geral', '', '<p><strong>Nenhum vencimento cadastrado ainda.</strong> (EMPTY_TRUE — sucesso genuíno, não erro)</p>' +
        '<div class="actions"><a class="btn btn-primary" href="#/items/new">+ Novo vencimento</a></div>',
        { navKey: 'overview' });
    }
    var overdue = active.filter(function (i) { return daysUntil(i.dueDate) < 0; });
    var soon = active.filter(function (i) { return daysUntil(i.dueDate) >= 0 && daysUntil(i.dueDate) <= 7; });
    function row(i) {
      return '<div class="list-item">' +
        '<span>' + statusLabelHtml(i) + '<strong>' + esc(i.name) + '</strong><br>' +
        '<span class="secondary-info">' + (daysUntil(i.dueDate) < 0 ? 'Venceu em ' : 'Vence em ') + fmtDate(i.dueDate) +
        ' (' + (daysUntil(i.dueDate) < 0 ? 'há ' + Math.abs(daysUntil(i.dueDate)) + ' dias' : 'em ' + daysUntil(i.dueDate) + ' dias') + ') · ' + esc(i.assignee) + '</span></span>' +
        '<a class="btn btn-primary" href="#/items/' + i.id + '?from=overview">Abrir</a>' +
        '</div>';
    }
    var body = '';
    if (overdue.length) body += '<h2 style="font-size:13px">VENCIDOS (' + overdue.length + ')</h2>' + overdue.map(row).join('');
    if (soon.length) body += '<h2 style="font-size:13px">VENCE EM BREVE (' + soon.length + ')</h2>' + soon.map(row).join('');
    if (!overdue.length && !soon.length) body += '<p>Nenhum item vencido ou vencendo em breve. (sucesso genuíno)</p>';
    body += blockedBlock('BLOCKER-B',
      'Nenhum resumo de alertas aparece aqui — a materialização de lembretes não está ' +
      'conectada ao caminho normal, então esta informação não é observável hoje.');
    body += '<div class="actions"><a class="btn btn-secondary" href="#/items/new">+ Novo vencimento</a></div>';
    return shell('Vencimentos — Visão Geral', '', body,
      { navKey: 'overview', a11y: 'status nunca só por cor; loading inicial anunciado (simulado via feedback de carregamento na 1ª renderização).' });
  });
  actions.retryOverview = function () { FLAGS.overviewLoadError = false; render(); };

  // =======================================================================
  // SURF-002 — Expiration Collection
  // =======================================================================
  route('/items', function (q) {
    var filter = q.status || 'all';
    if (FLAGS.collectionLoadError) {
      return shell('Vencimentos', '', feedback('failed', '✕', 'Falha de rede ao listar vencimentos.') +
        '<div class="actions"><button data-action="retryCollection" class="btn">Tentar novamente</button></div>', { navKey: 'items' });
    }
    var items = DB.items.slice();
    if (filter === 'overdue') items = items.filter(function (i) { return i.status === 'ACTIVE' && daysUntil(i.dueDate) < 0; });
    else if (filter === 'soon') items = items.filter(function (i) { return i.status === 'ACTIVE' && daysUntil(i.dueDate) >= 0 && daysUntil(i.dueDate) <= 7; });
    else if (filter === 'active') items = items.filter(function (i) { return i.status === 'ACTIVE'; });
    else if (filter === 'archived') items = items.filter(function (i) { return i.status === 'ARCHIVED' || i.status === 'RENEWED'; });

    var filters = ['all', 'overdue', 'soon', 'active', 'archived'].map(function (f) {
      var label = { all: 'Todos', overdue: 'Vencidos', soon: 'Vencendo', active: 'Ativos', archived: 'Arquivados' }[f];
      var cur = f === filter ? ' class="nav-current"' : '';
      return '<a href="#/items?status=' + f + '"' + cur + '>' + label + '</a>';
    }).join(' ');

    var body = '<p>Filtro: ' + filters + '</p>';
    if (DB.items.length === 0) {
      body += '<p><strong>Nenhum vencimento cadastrado ainda.</strong> (EMPTY_TRUE)</p>';
    } else if (items.length === 0) {
      body += '<p><strong>Nenhum vencimento corresponde a este filtro.</strong> (EMPTY_FILTERED — dados existem, filtro não retornou nada) ' +
        '<a href="#/items">limpar filtro</a></p>';
    } else {
      body += items.map(function (i) {
        return '<div class="list-item"><span>' + statusLabelHtml(i) + '<strong>' + esc(i.name) + '</strong> ' +
          '<span class="secondary-info">' + fmtDate(i.dueDate) + ' · ' + esc(i.assignee) + '</span></span>' +
          '<a class="btn btn-primary" href="#/items/' + i.id + '?from=items">Abrir</a></div>';
      }).join('');
    }
    body += '<p class="annot">(carregar mais — paginação real do backend é PARTIAL)</p>';
    body += '<div class="actions"><a class="btn btn-secondary" href="#/items/new">+ Novo</a> ' +
      '<a class="btn btn-secondary" href="#/import">Importar CSV</a></div>';
    return shell('Vencimentos', '', body, { navKey: 'items' });
  });
  actions.retryCollection = function () { FLAGS.collectionLoadError = false; render(); };

  // =======================================================================
  // SURF-003 — Expiration Detail
  // =======================================================================
  route('/items/:id', function (id, q) {
    var item = findItem(id);
    if (!item) {
      return shell('VENCIMENTO NÃO ENCONTRADO', '', '<p>Este vencimento não existe mais (excluído/arquivado por outro processo, ou pertence a outro tenant — mesmo estado externo, §20 SSI).</p>' +
        '<div class="actions"><a class="btn" href="#/overview">Voltar</a></div>', { navKey: 'items' });
    }
    var origin = q.from ? 'Veio de: ' + (q.from === 'overview' ? 'Overview' : 'Vencimentos') : '';
    var body = '';
    if (renewalSuccessFor === id) {
      body += feedback('success', '✓', 'Novo ciclo criado: vence em ' + fmtDate(item.dueDate) + '.') +
        feedback('success', '✓', 'Ciclo anterior preservado como [RENOVADO]: <a href="#/items/' + item.renewedFromId + '">' + esc(findItem(item.renewedFromId).name) + '</a>.');
      renewalSuccessFor = null; // shown once, on the fresh render that follows the renewal navigation
    }
    body += statusLabelHtml(item) +
      '<p class="primary-info">' + esc(item.name) + '</p>' +
      '<p class="secondary-info">' + (daysUntil(item.dueDate) < 0 ? 'Venceu em ' : 'Vence em ') + fmtDate(item.dueDate) +
      ' (' + (daysUntil(item.dueDate) < 0 ? 'há ' + Math.abs(daysUntil(item.dueDate)) + ' dias' : 'em ' + daysUntil(item.dueDate) + ' dias') + ')</p>' +
      '<p class="secondary-info">Responsável: ' + esc(item.assignee) + '</p>';
    if (item.renewedFromId) body += '<p class="contextual-info">Ciclo anterior: <a href="#/items/' + item.renewedFromId + '">' + esc(findItem(item.renewedFromId).name) + '</a></p>';
    if (item.renewedToId) body += '<p class="contextual-info">Substituído por um novo ciclo: <a href="#/items/' + item.renewedToId + '">abrir</a></p>';

    body += '<h2 style="font-size:13px">DOCUMENTO</h2>' +
      blockedBlock('BLOCKER-A', 'Não é possível saber hoje se já existe um documento associado a este vencimento — nenhuma rota de leitura existe.') +
      '<div class="actions"><a class="btn btn-secondary" href="#/items/' + id + '/document">Enviar documento</a></div>';

    body += '<h2 style="font-size:13px">ALERTA</h2>';
    if (item.alertPolicy) {
      body += '<p>✓ [ALERTA CONFIGURADO] Avisar ' + item.alertPolicy.offsetDays + ' dias antes · ' + esc(item.alertPolicy.channel) +
        '<br><span class="annot">(política salva — não garante entrega, BLOCKER-B)</span></p>';
    } else {
      body += '<p>Nenhum alerta configurado para este vencimento.</p>';
    }
    body += '<div class="actions"><a class="btn btn-secondary" href="#/items/' + id + '/alert">' + (item.alertPolicy ? 'Editar alerta' : 'Configurar alerta') + '</a></div>';

    body += '<div class="actions">' +
      (item.status === 'ACTIVE' ? '<a class="btn btn-primary" href="#/items/' + id + '/renew">Renovar</a> ' : '') +
      '<button class="btn btn-secondary" data-action="editItem" data-id="' + id + '">Editar</button> ' +
      (item.status === 'ACTIVE' ? '<button class="btn btn-dangerous" data-action="confirmArchive" data-id="' + id + '">Arquivar</button> ' : '') +
      (item.status === 'ACTIVE' ? '<button class="btn btn-dangerous" data-action="confirmDelete" data-id="' + id + '">Excluir</button>' : '') +
      '</div><div id="confirm-slot"></div>';

    return shell(item.name.toUpperCase(), esc(origin), body,
      { navKey: 'items', a11y: 'ações de alta consequência navegáveis por teclado, com confirmação deliberada.' });
  });

  actions.editItem = function () { announce('Edição de campos administrativos — fora do escopo desta etapa de prototipação (mesma seção estrutural do wireframe SURF-003).'); };

  actions.confirmArchive = function (el) {
    var id = el.getAttribute('data-id');
    document.getElementById('confirm-slot').innerHTML =
      '<div class="confirm-row">Arquivar "' + esc(findItem(id).name) + '"? Ele deixa de aparecer nas listas ativas.' +
      ' <button class="btn btn-dangerous" data-action="doArchive" data-id="' + id + '">Confirmar arquivamento</button>' +
      ' <button class="btn" data-action="cancelConfirm">Cancelar</button></div>';
    afterRender(document.getElementById('app'));
  };
  actions.confirmDelete = function (el) {
    var id = el.getAttribute('data-id');
    document.getElementById('confirm-slot').innerHTML =
      '<div class="confirm-row">Excluir "' + esc(findItem(id).name) + '"? Esta ação não pode ser desfeita pela interface.' +
      ' <button class="btn btn-dangerous" data-action="doDelete" data-id="' + id + '">Confirmar exclusão</button>' +
      ' <button class="btn" data-action="cancelConfirm">Cancelar</button></div>';
    afterRender(document.getElementById('app'));
  };
  actions.cancelConfirm = function () { document.getElementById('confirm-slot').innerHTML = ''; };
  actions.doArchive = function (el) {
    var id = el.getAttribute('data-id');
    if (FLAGS.forceConflictOnNextMutation) { FLAGS.forceConflictOnNextMutation = false; showDetailConflict(id, 'arquivar'); return; }
    findItem(id).status = 'ARCHIVED';
    announce('Vencimento arquivado.');
    navigate('#/items?status=archived');
  };
  actions.doDelete = function (el) {
    var id = el.getAttribute('data-id');
    if (FLAGS.forceConflictOnNextMutation) { FLAGS.forceConflictOnNextMutation = false; showDetailConflict(id, 'excluir'); return; }
    DB.items = DB.items.filter(function (i) { return i.id !== id; });
    announce('Vencimento excluído (soft delete — invisível a partir de agora).');
    navigate('#/items');
  };
  function showDetailConflict(id, verb) {
    var app = document.getElementById('app');
    var slot = document.getElementById('confirm-slot');
    if (slot) slot.innerHTML = feedback('unknown', '⚠',
      'CONFLICT: este vencimento foi alterado por outro processo desde que você o abriu. Não foi possível ' + verb + '-lo. ' +
      '<button class="btn" data-action="reloadDetail" data-id="' + id + '">Reler estado atual</button>');
    afterRender(app);
  }
  actions.reloadDetail = function (el) { render(); announce('Estado atual recarregado.'); };

  // =======================================================================
  // SURF-004 — Expiration Creation
  // =======================================================================
  route('/items/new', function () {
    var body = '<form novalidate data-form="submitCreate">' +
      '<div class="field"><label for="c-name">Nome *</label><input id="c-name" name="name" required></div>' +
      '<div class="field"><label for="c-cat">Categoria *</label>' +
      '<select id="c-cat" name="category"><option>Licença</option><option>Contrato</option><option>Certificado</option><option>Seguro</option></select></div>' +
      '<div class="field"><label for="c-due">Data de vencimento *</label><input id="c-due" name="dueDate" type="date" required></div>' +
      '<details class="optional-section"><summary>Opcional (Fornecedor/Requisito, Alerta inicial)</summary>' +
      '<div class="field"><label for="c-req">Requisito relacionado (opcional)</label>' +
      '<select id="c-req" name="requirementId"><option value="">Nenhum</option>' +
      DB.requirements.filter(function (r) { return r.status === 'MISSING'; }).map(function (r) {
        return '<option value="' + r.id + '">' + esc(findSubject(r.subjectId).name) + ' — ' + esc(r.name) + '</option>';
      }).join('') + '</select></div></details>' +
      '<div id="create-error"></div>' +
      '<div class="actions"><button type="submit" class="btn btn-primary">Criar vencimento</button></div>' +
      '</form><div id="create-feedback"></div>';
    return shell('Novo Vencimento', '', body, { navKey: 'items', a11y: 'erro de validação aparece junto ao campo específico, valores preservados.' });
  });
  actions.submitCreate = function (form) {
    var name = form.querySelector('[name=name]').value.trim();
    var due = form.querySelector('[name=dueDate]').value;
    var errBox = document.getElementById('create-error');
    errBox.innerHTML = '';
    var errors = [];
    if (!name) errors.push('Nome — obrigatório.');
    if (!due) errors.push('Data de vencimento — obrigatória.');
    if (errors.length) {
      errBox.innerHTML = errors.map(function (e) { return '<div class="field-error">' + esc(e) + '</div>'; }).join('');
      announce('Formulário com erro de validação. Dados preenchidos foram preservados.');
      return;
    }
    var fb = document.getElementById('create-feedback');
    fb.innerHTML = feedback('pending', '⏳', 'Criando vencimento…');
    announce('Criando vencimento…');
    window.setTimeout(function () {
      if (FLAGS.createOutcome === 'unknown') {
        fb.innerHTML = feedback('unknown', '⚠',
          'Não foi possível confirmar se o vencimento foi criado. Isto pode acontecer por instabilidade de rede. ' +
          'Não reenviamos automaticamente para evitar duplicidade (CREATE-IDEMPOTENCY-01). ' +
          '<div class="actions"><a class="btn btn-primary" href="#/items">Ver meus vencimentos e confirmar</a>' +
          ' <button class="btn btn-secondary" data-action="retryCreateManually">Preencher novamente</button></div>');
        afterRender(document.getElementById('app'));
        announce('Resultado incerto: não foi possível confirmar a criação.');
        return;
      }
      var cat = form.querySelector('[name=category]').value;
      var reqId = form.querySelector('[name=requirementId]').value;
      var item = { id: uid('item'), name: name, category: cat, dueDate: due, status: 'ACTIVE', assignee: '(não informado)', version: 1 };
      DB.items.push(item);
      if (reqId) { var r = findRequirement(reqId); r.status = 'SATISFIED'; r.linkedItemId = item.id; }
      announce('Vencimento criado: ' + name);
      navigate('#/items/' + item.id + '?from=items');
    }, 500);
  };
  actions.retryCreateManually = function () { render(); };

  // =======================================================================
  // SURF-005 — Expiration Renewal
  // =======================================================================
  route('/items/:id/renew', function (id) {
    var item = findItem(id);
    if (!item) return notFoundSurface('/items/' + id + '/renew');
    if (item.status !== 'ACTIVE') {
      return shell('RENOVAR — ' + item.name.toUpperCase(), 'Veio de: Detalhe',
        feedback('failed', '✕', 'Este vencimento não está mais ativo (já foi ' + (item.status === 'ARCHIVED' ? 'arquivado' : 'renovado') + ') — não é possível renovar novamente.') +
        '<div class="actions"><a class="btn" href="#/items/' + id + '">Voltar ao detalhe</a></div>', { navKey: 'items' });
    }
    var body = '<p class="secondary-info">Ciclo atual: vence em ' + fmtDate(item.dueDate) + '</p>' +
      '<form novalidate data-form="submitRenew" data-id="' + id + '">' +
      '<div class="field"><label for="r-due">Nova data de vencimento *</label><input id="r-due" name="dueDate" type="date" required value="' + addDays(item.dueDate, 365) + '"></div>' +
      '<p>⚠ Renovar cria um <strong>novo ciclo</strong> — o ciclo atual será preservado como histórico ([RENOVADO]), não editado.</p>' +
      blockedBlock('BLOCKER-A', 'Não é possível confirmar hoje qual documento pertence a qual ciclo.') +
      '<div id="renew-error"></div>' +
      '<div class="actions"><button type="submit" class="btn btn-dangerous">Confirmar renovação</button></div>' +
      '</form><div id="renew-feedback"></div>';
    return shell('RENOVAR — ' + item.name.toUpperCase(), 'Veio de: Detalhe', body,
      { navKey: 'items', a11y: 'a mensagem de renovar≠editar aparece antes da confirmação, não só depois.' });
  });
  actions.submitRenew = function (form) {
    var id = form.getAttribute('data-id');
    var item = findItem(id);
    var newDue = form.querySelector('[name=dueDate]').value;
    var errBox = document.getElementById('renew-error');
    errBox.innerHTML = '';
    if (!newDue || newDue <= item.dueDate) {
      errBox.innerHTML = '<div class="field-error">Nova data de vencimento — deve ser posterior à data atual (' + fmtDate(item.dueDate) + ').</div>';
      announce('Erro de validação: data inválida.');
      return;
    }
    if (FLAGS.forceConflictOnNextMutation) {
      FLAGS.forceConflictOnNextMutation = false;
      document.getElementById('renew-feedback').innerHTML = feedback('unknown', '⚠',
        'CONFLICT: este vencimento foi alterado desde que você abriu esta tela. Releia o estado atual antes de renovar. ' +
        '<button class="btn" data-action="reloadRenew" data-id="' + id + '">Reler estado atual</button>');
      afterRender(document.getElementById('app'));
      announce('Conflito de concorrência detectado.');
      return;
    }
    var fb = document.getElementById('renew-feedback');
    fb.innerHTML = feedback('pending', '⏳', 'Renovando…');
    announce('Renovando…');
    window.setTimeout(function () {
      if (FLAGS.renewOutcome === 'unknown') {
        fb.innerHTML = feedback('unknown', '⚠', 'Não foi possível confirmar a renovação — reconsultando o estado atual (idempotência real existe para esta operação, diferente de criação)…');
        afterRender(document.getElementById('app'));
        window.setTimeout(function () { doRenew(item, newDue); }, 700);
        return;
      }
      doRenew(item, newDue);
    }, 500);
  };
  var renewalSuccessFor = null; // itemId whose NEXT /items/:id render should show the dual-claim banner
  function doRenew(item, newDue) {
    var newItem = { id: uid('item'), name: item.name, category: item.category, dueDate: newDue, status: 'ACTIVE', assignee: item.assignee, version: 1, renewedFromId: item.id };
    item.status = 'RENEWED';
    item.renewedToId = newItem.id;
    DB.items.push(newItem);
    renewalSuccessFor = newItem.id;
    announce('Novo ciclo criado; ciclo anterior preservado como Renovado.');
    navigate('#/items/' + newItem.id); // single hashchange -> single render(), no manual DOM patching
  }
  actions.reloadRenew = function (el) { render(); announce('Estado atual recarregado.'); };

  // =======================================================================
  // SURF-006 — Document Context
  // =======================================================================
  route('/items/:id/document', function (id) {
    var item = findItem(id);
    if (!item) return notFoundSurface('/items/' + id + '/document');
    var st = docSessionEntry[id]; // undefined on a fresh visit — see onFreshEntry()
    var body = '';
    if (!st) {
      body += blockedBlock('BLOCKER-A',
        'Não é possível saber hoje se já existe um documento enviado para este vencimento (nenhuma rota de leitura) — ' +
        '"nenhum documento ainda" seria uma afirmação que a interface não tem como confirmar, não um vazio genuíno.') +
        '<p>Você pode enviar um novo arquivo abaixo. Formatos aceitos: PDF, JPEG, PNG · até 10 MB.</p>' +
        '<div class="field"><label for="doc-file">Arquivo</label><input id="doc-file" type="file"></div>' +
        '<div class="actions"><button class="btn btn-primary" data-action="submitUpload" data-id="' + id + '">Enviar</button></div>';
    } else if (st.state === 'uploading') {
      body += feedback('pending', '⏳', 'Enviando… (TTL da reserva: 10 min)');
    } else if (st.state === 'unknown') {
      body += feedback('unknown', '⚠', 'Não sabemos se o arquivo chegou (falha de rede durante o envio). Envie novamente — uma nova reserva é necessária, nunca assumimos sucesso parcial.') +
        '<div class="actions"><button class="btn btn-primary" data-action="retryUpload" data-id="' + id + '">Enviar novamente</button></div>';
    } else if (st.state === 'sent') {
      body += feedback('success', '✓', 'Upload enviado.') +
        blockedBlock('BLOCKER-A',
          'A partir daqui não é possível consultar o que acontece com o arquivo (verificação de segurança, resultado, ou reabri-lo depois). ' +
          'SIMULATED FOR UX VALIDATION — NOT CURRENTLY SUPPORTED BY BACKEND. Esta seção mostraria "[ARQUIVO VERIFICADO]" ou ' +
          '"[ARQUIVO REJEITADO PELA VERIFICAÇÃO DE SEGURANÇA]" assim que essa capacidade existir — nunca "Aprovado", nunca "verificando segurança" como fato confirmado.') +
        '<div class="actions"><button class="btn btn-secondary" data-action="retryUpload" data-id="' + id + '">Enviar outro arquivo</button></div>';
    }
    return shell('DOCUMENTO — ' + item.name.toUpperCase(), 'Veio de: Detalhe', body,
      { navKey: 'items', a11y: 'seleção de arquivo tem alternativa a drag-and-drop (input file nativo); confirmação de envio é anunciada.' });
  });
  actions.submitUpload = function (el) {
    var id = el.getAttribute('data-id');
    docSessionEntry[id] = { state: 'uploading' };
    render();
    announce('Enviando arquivo…');
    window.setTimeout(function () {
      docSessionEntry[id] = { state: FLAGS.uploadOutcome === 'networkFail' ? 'unknown' : 'sent' };
      render();
      announce(FLAGS.uploadOutcome === 'networkFail' ? 'Não foi possível confirmar o envio.' : 'Upload enviado.');
    }, 600);
  };
  actions.retryUpload = function (el) { var id = el.getAttribute('data-id'); delete docSessionEntry[id]; render(); };

  // =======================================================================
  // SURF-007 — Alert Configuration
  // =======================================================================
  route('/items/:id/alert', function (id) {
    var item = findItem(id);
    if (!item) return notFoundSurface('/items/' + id + '/alert');
    var body = '<form novalidate data-form="submitAlert" data-id="' + id + '">' +
      '<div class="field"><label for="a-days">Avisar-me quantos dias antes? *</label><input id="a-days" name="offset" type="number" min="1" value="' + (item.alertPolicy ? item.alertPolicy.offsetDays : 7) + '"></div>' +
      '<p>Canal: E-mail (único canal disponível hoje)</p>' + // no other channel is even mentioned to the user — WhatsApp is LATER/unsupported and stays out of user-facing copy entirely (product-creep fix, Codex round B)
      blockedBlock('BLOCKER-B',
        'Salvar esta política registra sua preferência, mas hoje não existe garantia de que o aviso será realmente ' +
        'enviado no momento configurado — a geração automática do aviso não está conectada. Esta seção nunca afirmará ' +
        '"você será avisado" até isso ser corrigido.') +
      '<div id="alert-error"></div>' +
      '<div class="actions"><button type="submit" class="btn btn-primary">Salvar</button> ' +
      (item.alertPolicy ? '<button type="button" class="btn btn-secondary" data-action="disableAlert" data-id="' + id + '">Desabilitar alerta</button>' : '') + '</div>' +
      '</form><div id="alert-feedback"></div>';
    return shell('ALERTA — ' + item.name.toUpperCase(), 'Veio de: Detalhe', body, { navKey: 'items' });
  });
  actions.submitAlert = function (form) {
    var id = form.getAttribute('data-id');
    var offset = parseInt(form.querySelector('[name=offset]').value, 10);
    var errBox = document.getElementById('alert-error');
    if (!offset || offset < 1) { errBox.innerHTML = '<div class="field-error">Informe um número de dias válido (maior que zero).</div>'; return; }
    errBox.innerHTML = '';
    var fb = document.getElementById('alert-feedback');
    fb.innerHTML = feedback('pending', '⏳', 'Salvando…');
    window.setTimeout(function () {
      findItem(id).alertPolicy = { offsetDays: offset, channel: 'E-mail' };
      fb.innerHTML = feedback('success', '✓', '[ALERTA CONFIGURADO] Avisar ' + offset + ' dias antes · E-mail. (política salva — ver aviso de BLOCKER-B acima; nunca "agendado" ou "entregue")');
      announce('Política de alerta salva.');
    }, 400);
  };
  actions.disableAlert = function (el) { findItem(el.getAttribute('data-id')).alertPolicy = null; render(); announce('Alerta desabilitado.'); };

  // =======================================================================
  // SURF-008 — Subject Collection
  // =======================================================================
  route('/subjects', function () {
    var body = DB.subjects.length === 0
      ? '<p><strong>Nenhum fornecedor cadastrado ainda.</strong></p>'
      : DB.subjects.map(function (s) {
        return '<div class="list-item"><span><strong>' + esc(s.name) + '</strong> <span class="secondary-info">' +
          pendingCount(s.id) + ' pendentes · ' + linkedCount(s.id) + ' vinculados</span></span>' +
          '<a class="btn btn-primary" href="#/subjects/' + s.id + '">Abrir</a></div>';
      }).join('');
    body += '<div class="actions"><button class="btn btn-secondary" data-action="notImplemented">+ Novo fornecedor</button></div>';
    return shell('Fornecedores', '', body, { navKey: 'subjects' });
  });
  actions.notImplemented = function () { announce('Ação fora do escopo de prototipação desta etapa (não afeta as journeys críticas).'); };

  // =======================================================================
  // SURF-009 — Subject Detail
  // =======================================================================
  route('/subjects/:id', function (id) {
    var subj = findSubject(id);
    if (!subj) return notFoundSurface('/subjects/' + id);
    var reqs = requirementsOf(id);
    var body = '<p class="secondary-info">Tipo: ' + esc(subj.type) + '</p><h2 style="font-size:13px">REQUISITOS</h2>' +
      (reqs.length === 0 ? '<p>Nenhum requisito ainda.</p>' : reqs.map(function (r) {
        var label = r.status === 'MISSING' ? '[PENDENTE]' : '[VINCULADO A UM VENCIMENTO]';
        return '<div class="list-item"><span>' + label + ' ' + esc(r.name) + '</span>' +
          '<a class="btn btn-primary" href="#/subjects/' + id + '/requirements/' + r.id + '">Abrir</a></div>';
      }).join('')) +
      '<div class="actions"><button class="btn btn-secondary" data-action="notImplemented">+ Novo requisito</button></div>';
    return shell(subj.name.toUpperCase(), 'Veio de: Fornecedores', body, { navKey: 'subjects' });
  });

  // =======================================================================
  // SURF-010 — Requirement Context
  // =======================================================================
  route('/subjects/:sid/requirements/:rid', function (sid, rid) {
    var subj = findSubject(sid), req = findRequirement(rid);
    if (!subj || !req) return notFoundSurface('/subjects/' + sid + '/requirements/' + rid);
    var reqs4this = DB.documentRequests.filter(function (dr) { return dr.requirementId === rid; });
    var body = '<p>' + (req.status === 'MISSING' ? '[PENDENTE]' : '[VINCULADO A UM VENCIMENTO]') + '</p>';
    if (req.status === 'SATISFIED') {
      body += '<p>Vinculado manualmente a: <a href="#/items/' + req.linkedItemId + '">' + esc(findItem(req.linkedItemId).name) + '</a></p>' +
        '<div class="actions"><button class="btn btn-secondary" data-action="unlinkReq" data-id="' + rid + '">Desvincular</button></div>';
    } else {
      body += '<h2 style="font-size:13px">SOLICITAÇÕES</h2>' +
        (reqs4this.length === 0 ? '<p>Nenhuma solicitação criada ainda. (EMPTY_NOT_READY)</p>' : reqs4this.map(function (dr) {
          return '<div class="list-item"><span>[' + drStatusLabel(dr) + '] ' + fmtDate(dr.sentAt) + ' → prazo ' + fmtDate(dr.deadline) + '</span>' +
            '<a class="btn btn-primary" href="#/requests/' + dr.id + '">Abrir</a></div>';
        }).join('')) +
        '<div class="actions"><a class="btn btn-primary" href="#/requests/new?rid=' + rid + '">Nova solicitação</a> ' +
        '<button class="btn btn-secondary" data-action="linkExisting" data-id="' + rid + '">Vincular a um vencimento existente</button></div>';
    }
    return shell(req.name.toUpperCase() + ' — ' + subj.name, 'Veio de: Fornecedor', body, { navKey: 'subjects' });
  });
  function drStatusLabel(dr) {
    if (dr.status === 'REQUESTED') return 'ENVIADA';
    if (dr.status === 'OPENED') return 'ABERTA PELO FORNECEDOR';
    if (dr.status === 'SUBMITTED') return 'DOCUMENTO RECEBIDO';
    if (dr.status === 'REVOKED') return 'REVOGADA';
    return dr.status;
  }
  actions.unlinkReq = function (el) { var r = findRequirement(el.getAttribute('data-id')); r.status = 'MISSING'; r.linkedItemId = null; render(); announce('Requisito desvinculado.'); };
  actions.linkExisting = function (el) {
    var rid = el.getAttribute('data-id');
    var options = DB.items.filter(function (i) { return i.status === 'ACTIVE'; })
      .map(function (i) { return '<option value="' + i.id + '">' + esc(i.name) + '</option>'; }).join('');
    var app = document.getElementById('app');
    var box = document.createElement('div');
    box.className = 'confirm-row';
    box.innerHTML = '<label for="link-select">Vincular a</label> <select id="link-select">' + options + '</select> ' +
      '<button class="btn btn-primary" data-action="doLink" data-id="' + rid + '">Confirmar vínculo (CONFIRMED)</button>';
    app.querySelector('section').appendChild(box);
    afterRender(app);
  };
  actions.doLink = function (el) {
    var rid = el.getAttribute('data-id');
    var itemId = document.getElementById('link-select').value;
    var r = findRequirement(rid);
    r.status = 'SATISFIED'; r.linkedItemId = itemId;
    render();
    announce('Vínculo confirmado manualmente.');
  };

  // =======================================================================
  // SURF-011 — Document Request Context (+ creation form)
  // =======================================================================
  route('/requests/new', function (q) {
    var req = findRequirement(q.rid);
    var body = '<form novalidate data-form="createRequest" data-rid="' + q.rid + '">' +
      '<div class="field"><label for="dr-email">E-mail do fornecedor *</label><input id="dr-email" name="email" type="email" required value="contato@transportadorasilva.com.br"></div>' +
      '<div class="field"><label for="dr-deadline">Prazo *</label><input id="dr-deadline" name="deadline" type="date" required value="' + addDays(TODAY, 14) + '"></div>' +
      '<div class="actions"><button type="submit" class="btn btn-primary">Enviar solicitação</button></div></form>';
    return shell('NOVA SOLICITAÇÃO — ' + (req ? req.name.toUpperCase() : ''), 'Veio de: Requisito', body, { navKey: 'subjects' });
  });
  actions.createRequest = function (form) {
    var rid = form.getAttribute('data-rid');
    var dr = { id: uid('dr'), requirementId: rid, recipient: form.querySelector('[name=email]').value, status: 'REQUESTED', sentAt: TODAY, deadline: form.querySelector('[name=deadline]').value, submission: null };
    DB.documentRequests.push(dr);
    announce('Solicitação enviada.');
    navigate('#/requests/' + dr.id);
  };
  route('/requests/:id', function (id) {
    var dr = findDocRequest(id);
    if (!dr) return notFoundSurface('/requests/' + id);
    var req = findRequirement(dr.requirementId);
    var body = '<p>[' + drStatusLabel(dr) + ']</p>' +
      '<p class="secondary-info">Enviada em ' + fmtDate(dr.sentAt) + ' · Prazo: ' + fmtDate(dr.deadline) + ' (' + daysUntil(dr.deadline) + ' dias)</p>' +
      '<p class="secondary-info">Enviada para: ' + esc(dr.recipient) + '</p>';
    if (dr.status === 'SUBMITTED') {
      body += blockedBlock('BLOCKER-C', 'Documento recebido ≠ requisito atendido. Veja a fila de revisão (branch point não decidido).') +
        '<div class="actions"><a class="btn btn-primary" href="#/submission-review?dr=' + id + '">Ver branch point (Submission Review)</a></div>';
    } else if (dr.status !== 'REVOKED') {
      body += '<div class="actions">' +
        '<button class="btn btn-secondary" data-action="simulateOpen" data-id="' + id + '"' + (dr.status !== 'REQUESTED' ? ' disabled' : '') + '>PROTOTYPE-ONLY: simular fornecedor abrindo o link</button> ' +
        '<button class="btn btn-secondary" data-action="simulateSubmit" data-id="' + id + '"' + (dr.status === 'REQUESTED' ? ' disabled' : '') + '>PROTOTYPE-ONLY: simular fornecedor enviando documento</button>' +
        '</div>' +
        '<div class="actions"><button class="btn btn-dangerous" data-action="confirmRevoke" data-id="' + id + '">Revogar solicitação</button></div>' +
        '<div id="revoke-slot"></div>';
    }
    return shell('SOLICITAÇÃO — ' + req.name.toUpperCase(), 'Veio de: Requisito', body,
      { navKey: 'subjects', a11y: 'revogação exige confirmação deliberada, navegável por teclado.' });
  });
  actions.simulateOpen = function (el) { findDocRequest(el.getAttribute('data-id')).status = 'OPENED'; render(); announce('(prototype-only) Fornecedor abriu o link.'); };
  actions.simulateSubmit = function (el) {
    var dr = findDocRequest(el.getAttribute('data-id'));
    dr.status = 'SUBMITTED';
    // dr.submission tracks the SIMULATED internal scan outcome so the branch-point demo (SURF-012)
    // has something to react to — but this fact is NEVER surfaced to the Internal Operator here:
    // SECURITY_CHECK_PENDING/CLEAN is NOT_CURRENTLY_OBSERVABLE for the operator (SSI §28), so the
    // product-facing announcement below only states what "documento recebido" actually means.
    dr.submission = { status: 'CLEAN' };
    render();
    announce('(prototype-only, ator externo simulado) Fornecedor enviou o documento. O resultado da verificação de segurança não é observável aqui.');
  };
  actions.confirmRevoke = function (el) {
    var id = el.getAttribute('data-id');
    document.getElementById('revoke-slot').innerHTML = '<div class="confirm-row">O fornecedor perde acesso ao link imediatamente — irreversível. ' +
      '<button class="btn btn-dangerous" data-action="doRevoke" data-id="' + id + '">Confirmar revogação</button> ' +
      '<button class="btn" data-action="cancelConfirm2">Cancelar</button></div>';
    afterRender(document.getElementById('app'));
  };
  actions.cancelConfirm2 = function () { document.getElementById('revoke-slot').innerHTML = ''; };
  actions.doRevoke = function (el) { findDocRequest(el.getAttribute('data-id')).status = 'REVOKED'; render(); announce('Solicitação revogada.'); };

  // =======================================================================
  // SURF-012 — Submission Review (branch point, two variants — neither decided)
  // =======================================================================
  route('/submission-review', function (q) {
    var variant = q.variant || 'select';
    var dr = q.dr ? findDocRequest(q.dr) : null;
    if (variant === 'select') {
      var body = '<p>Esta superfície inteira é <strong>DESIGN REQUIRED / IMPLEMENTATION BLOCKED</strong> — sua existência ' +
        'depende de uma decisão de produto ainda não tomada (BLOCKER-C). Escolha uma variante para demonstrar, sem que isso decida nada:</p>' +
        '<div class="actions"><a class="btn" href="#/submission-review?variant=a' + (q.dr ? '&dr=' + q.dr : '') + '">Ver Variante A — fechamento automático</a>' +
        ' <a class="btn" href="#/submission-review?variant=b' + (q.dr ? '&dr=' + q.dr : '') + '">Ver Variante B — revisão humana</a></div>';
      return shell('SUBMISSION REVIEW — BRANCH POINT (BLOCKER-C)', '', body, { navKey: 'requests' });
    }
    if (variant === 'a') {
      var body = blockedBlock('BLOCKER-C — Variante A (hipótese, não decidida)',
        'SIMULATED FOR UX VALIDATION — NOT CURRENTLY SUPPORTED BY BACKEND. Se escolhida, SURF-012 deixaria de existir ' +
        'como superfície própria; o requisito seria gravado como [VINCULADO A UM VENCIMENTO] automaticamente, sem checkpoint humano. ' +
        '"SATISFIED" continuaria significando só "vinculado", nunca "compliance atual".') +
        '<div class="actions"><button class="btn btn-primary" data-action="simulateVariantA" data-dr="' + (dr ? dr.id : '') + '">Simular vínculo automático</button></div>' +
        '<div id="variant-a-fb"></div>';
      return shell('SUBMISSION REVIEW — VARIANTE A', '', body, { navKey: 'requests' });
    }
    var body = blockedBlock('BLOCKER-C — Variante B (hipótese, não decidida)',
      'SIMULATED FOR UX VALIDATION — NOT CURRENTLY SUPPORTED BY BACKEND. Fila de confirmação humana, hoje sem nenhuma rota de leitura real.') +
      '<div class="list-item"><span>' + (dr ? esc(findSubject(findRequirement(dr.requirementId).subjectId).name) + ' — ' + esc(findRequirement(dr.requirementId).name) : 'Transportadora Silva Ltda. — Apólice de Seguro RC') + '<br>' +
      '<span class="secondary-info">Documento recebido em ' + TODAY + '</span></span></div>' +
      '<div class="actions"><button class="btn btn-primary" data-action="simulateVariantB" data-dr="' + (dr ? dr.id : '') + '" data-decision="link">Vincular a vencimento existente</button>' +
      ' <button class="btn btn-dangerous" data-action="simulateVariantB" data-dr="' + (dr ? dr.id : '') + '" data-decision="reject">Rejeitar</button></div>' +
      '<div id="variant-b-fb"></div>';
    return shell('SUBMISSION REVIEW — VARIANTE B', '', body, { navKey: 'requests' });
  });
  actions.simulateVariantA = function (el) {
    var drId = el.getAttribute('data-dr');
    if (drId) { var req = findRequirement(findDocRequest(drId).requirementId); req.status = 'SATISFIED'; }
    document.getElementById('variant-a-fb').innerHTML = feedback('success', '✓', '(simulado) [VINCULADO A UM VENCIMENTO] — vínculo automático, sem passo humano.');
    announce('(prototype-only) Variante A simulada.');
  };
  actions.simulateVariantB = function (el) {
    var decision = el.getAttribute('data-decision');
    var drId = el.getAttribute('data-dr');
    if (decision === 'link' && drId) { var req = findRequirement(findDocRequest(drId).requirementId); req.status = 'SATISFIED'; }
    document.getElementById('variant-b-fb').innerHTML = feedback(decision === 'link' ? 'success' : 'failed', decision === 'link' ? '✓' : '✕',
      decision === 'link' ? '(simulado) Operador vinculou manualmente — [VINCULADO A UM VENCIMENTO].' : '(simulado) Operador rejeitou — requisito permanece [PENDENTE], nova solicitação pode ser criada.');
    announce('(prototype-only) Variante B simulada: ' + decision + '.');
  };

  // =======================================================================
  // SURF-013 — Requests Collection (always BLOCKED)
  // =======================================================================
  route('/requests-collection', function () {
    var body = blockedBlock('Query tenant-wide inexistente',
      'Não existe hoje uma consulta que traga todas as solicitações pendentes de todos os fornecedores de uma vez — ' +
      'cada uma só é acessível a partir do Requisito/Fornecedor específico.') +
      '<div class="actions"><a class="btn" href="#/subjects">Ir para Fornecedores</a></div>';
    return shell('Solicitações (todos os fornecedores)', '', body, { navKey: 'requests' });
  });

  // =======================================================================
  // SURF-014 — Guest Submission (isolated shell, no SaaS chrome)
  // =======================================================================
  function resolveGuestToken(token) {
    var rec = DB.guestTokens[token];
    if (!rec || rec.revoked || rec.expired) return null; // converges: invalid/expired/revoked/not-found are indistinguishable here
    return rec;
  }
  // States below mirror SSI §29 one-for-one, each with a distinct render — none compressed:
  // RequestLoaded -> FileSelected -> ReservationPending -> ReservationAccepted -> UploadInFlight
  // -> UploadAcceptedByBrowser | UploadUnknownOutcome
  var guestSession = {};
  route('/guest/:token', function (token) {
    var info = resolveGuestToken(token);
    if (!info) {
      return shell('Solicitação de Documento', '', '<p>✕ Este link não está disponível.</p><p class="annot">(mesma mensagem para link inválido, expirado, revogado ou não encontrado — nunca diferenciado, anti-enumeração)</p>', { guest: true });
    }
    var st = guestSession[token] || { state: 'loaded' };
    var body = '';
    var gtr01 = blockedBlock('GTR-01', 'Quem está solicitando: não exibido hoje — nenhuma rota expõe a identidade da organização requisitante. ' +
      'DESIGN REQUIRED — estrutura correta esperada: "Solicitado por: &lt;organização&gt;" nesta posição.') +
      '<p><strong>Documento solicitado:</strong> ' + esc(info.requirementName) + '</p>' +
      '<p>Prazo: ' + fmtDate(info.deadline) + '</p>' +
      '<p>Formatos aceitos: ' + esc(info.allowedTypes) + ' · até ' + esc(info.maxBytes) + '</p>';
    if (st.state === 'loaded') {
      body += gtr01 +
        '<div class="field"><label for="g-file">Selecionar arquivo</label><input id="g-file" type="file" data-onchange="guestFileSelected" data-token="' + esc(token) + '"></div>' +
        (st.fileError ? '<div class="field-error">' + esc(st.fileError) + '</div>' : '');
    } else if (st.state === 'fileSelected') {
      body += gtr01 +
        '<p class="secondary-info">Arquivo selecionado: ' + esc(st.fileName) + '</p>' +
        '<div class="actions"><button class="btn btn-primary" data-action="guestSubmit" data-token="' + esc(token) + '">Enviar documento</button>' +
        ' <button class="btn btn-secondary" data-action="guestReset" data-token="' + esc(token) + '">Escolher outro arquivo</button></div>';
    } else if (st.state === 'reserving') {
      body += feedback('pending', '⏳', 'Reservando envio…');
    } else if (st.state === 'reservationAccepted') {
      body += feedback('success', '✓', 'Reserva aceita.') + '<p class="annot">(isto não é "documento enviado" — é só "posso enviar agora")</p>' +
        feedback('pending', '⏳', 'Enviando arquivo…');
    } else if (st.state === 'unknown') {
      body += feedback('unknown', '⚠', 'Não foi possível confirmar o envio (rede instável). O reenvio é seguro — pode tentar novamente.') +
        '<div class="actions"><button class="btn btn-primary" data-action="guestRetry" data-token="' + esc(token) + '">Enviar novamente</button></div>';
    } else if (st.state === 'sent') {
      body += feedback('success', '✓', 'Envio recebido pelo seu navegador.') +
        blockedBlock('Guest verification visibility gap',
          'Não é possível confirmar aqui se o arquivo passou pela verificação de segurança — esta página não tem essa informação. ' +
          'SIMULATED FOR UX VALIDATION — NOT CURRENTLY SUPPORTED BY BACKEND. Se necessário, entre em contato com quem solicitou o documento.');
    }
    return shell('Solicitação de Documento', '', body, { guest: true, a11y: 'câmera/arquivo nativo — sem depender só de drag-and-drop.' });
  });
  actions.guestFileSelected = function (el) {
    var token = el.getAttribute('data-token');
    var file = el.files && el.files[0];
    if (!file) return;
    var okType = /^(application\/pdf|image\/jpeg|image\/png)$/.test(file.type) || file.type === ''; // '' covers test fixtures/unknown-extension browsers
    var okSize = file.size <= 10 * 1024 * 1024;
    if (!okType || !okSize) {
      guestSession[token] = { state: 'loaded', fileError: !okType ? 'Tipo de arquivo não aceito — envie PDF, JPEG ou PNG.' : 'Arquivo maior que 10 MB.' };
      render();
      announce('Arquivo inválido: ' + guestSession[token].fileError);
      return;
    }
    guestSession[token] = { state: 'fileSelected', fileName: file.name };
    render();
    announce('Arquivo selecionado: ' + file.name);
  };
  actions.guestReset = function (el) { guestSession[el.getAttribute('data-token')] = { state: 'loaded' }; render(); };
  actions.guestSubmit = function (el) {
    var token = el.getAttribute('data-token');
    guestSession[token] = { state: 'reserving' };
    render();
    announce('Reservando envio…');
    window.setTimeout(function () {
      guestSession[token] = { state: 'reservationAccepted' };
      render();
      announce('Reserva aceita. Enviando arquivo…');
      window.setTimeout(function () {
        guestSession[token] = { state: FLAGS.guestUploadOutcome === 'networkFail' ? 'unknown' : 'sent' };
        render();
        announce(FLAGS.guestUploadOutcome === 'networkFail' ? 'Não foi possível confirmar o envio.' : 'Envio recebido pelo navegador.');
      }, 500);
    }, 400);
  };
  actions.guestRetry = function (el) { delete guestSession[el.getAttribute('data-token')]; render(); };

  // =======================================================================
  // SURF-015 — Import Flow
  // =======================================================================
  route('/import', function (q) {
    var job = q.job ? DB.importJobs[q.job] : null;
    var body;
    if (!job) {
      body = '<div class="field"><label for="imp-file">Selecionar arquivo CSV (até 5 MB)</label><input id="imp-file" type="file" accept=".csv"></div>' +
        '<div class="actions"><button class="btn btn-primary" data-action="startImport">Continuar</button></div>';
      return shell('Importar Planilha (1/4 — selecionar)', '', body, { navKey: 'items' });
    }
    if (job.status === 'UPLOADING') {
      body = feedback('pending', '⏳', 'Enviando planilha_fornecedores.csv… (TTL: 15 min)');
      return shell('Importar Planilha (2/4 — enviando)', '', body, { navKey: 'items' });
    }
    if (job.status === 'PARSING') {
      body = feedback('pending', '⏳', 'Processando planilha… (você pode sair e voltar — o progresso é recuperável, GET /imports/{jobId})') +
        '<div class="actions"><button class="btn btn-secondary" data-action="checkImport" data-job="' + job.id + '">Consultar status</button></div>';
      return shell('Importar Planilha (3/4 — processando)', '', body, { navKey: 'items' });
    }
    if (job.status === 'FAILED') {
      body = feedback('failed', '✕', 'Falha ao processar o CSV (formato inválido). Não é possível retomar este job — inicie uma nova importação.') +
        '<div class="actions"><a class="btn" href="#/import">Nova importação</a></div>';
      return shell('Importar Planilha — Falha', '', body, { navKey: 'items' });
    }
    if (job.status === 'EXPIRED') {
      body = feedback('failed', '✕', 'Este job expirou sem ser confirmado (prazo de revisão encerrado). Diferente de FAILED: nada deu errado no processamento — o job só ficou parado tempo demais. Não é possível retomá-lo — inicie uma nova importação.') +
        '<div class="actions"><a class="btn" href="#/import">Nova importação</a></div>';
      return shell('Importar Planilha — Expirado', '', body, { navKey: 'items' });
    }
    if (job.status === 'PREVIEW_READY') {
      body = '<p>Total de linhas: ' + job.counts.total + '</p>' +
        '<p>Aceitas: ' + job.counts.accepted + ' · Rejeitadas: ' + job.counts.rejected + ' · Duplicadas: ' + job.counts.duplicated + '</p>' +
        blockedBlock('Erro por linha (PARTIAL)', 'Não é possível hoje ver quais linhas foram rejeitadas nem por quê — só a contagem agregada está disponível.') +
        '<div class="actions"><button class="btn btn-primary" data-action="commitImport" data-job="' + job.id + '">Confirmar importação</button>' +
        ' <a class="btn btn-secondary" href="#/import">Cancelar</a></div>';
      return shell('Importar Planilha (3/4 — revisar)', '', body, { navKey: 'items' });
    }
    if (job.status === 'COMMITTING') {
      body = feedback('pending', '⏳', 'Aplicando importação…');
      return shell('Importar Planilha — aplicando', '', body, { navKey: 'items' });
    }
    if (job.status === 'UNKNOWN_OUTCOME') {
      body = feedback('unknown', '⚠', 'Não foi possível confirmar o resultado do commit — reconsultando automaticamente (idempotente via GET /imports/{jobId})…') +
        '<div class="actions"><button class="btn btn-secondary" data-action="reconcileImport" data-job="' + job.id + '">Reconsultar agora</button></div>';
      return shell('Importar Planilha — resultado incerto', '', body, { navKey: 'items' });
    }
    if (job.status === 'COMMITTED') {
      body = feedback('success', '✓', job.counts.accepted + ' registros criados.') +
        '<div class="actions"><a class="btn btn-primary" href="#/items">Ver vencimentos importados</a></div>';
      return shell('Importar Planilha (4/4 — concluído)', '', body, { navKey: 'items' });
    }
    return notFoundSurface('/import');
  });
  actions.startImport = function () {
    var job = { id: uid('job'), status: 'UPLOADING' };
    DB.importJobs[job.id] = job;
    navigate('#/import?job=' + job.id);
    window.setTimeout(function () {
      job.status = FLAGS.importOutcome === 'parseFailed' ? 'FAILED' : 'PARSING';
      render();
      if (job.status === 'PARSING') {
        window.setTimeout(function () {
          if (FLAGS.importOutcome === 'expired') {
            job.status = 'EXPIRED';
            render();
            announce('Job expirado sem confirmação.');
            return;
          }
          job.status = 'PREVIEW_READY';
          job.counts = { total: 42, accepted: 38, rejected: 3, duplicated: 1 };
          render();
          announce('Planilha processada. Pronta para revisão.');
        }, 700);
      } else {
        announce('Falha ao processar a planilha.');
      }
    }, 500);
  };
  actions.checkImport = function () { render(); };
  actions.commitImport = function (el) {
    var job = DB.importJobs[el.getAttribute('data-job')];
    job.status = 'COMMITTING';
    render();
    window.setTimeout(function () {
      if (FLAGS.importOutcome === 'unknown') { job.status = 'UNKNOWN_OUTCOME'; render(); announce('Resultado do commit incerto.'); return; }
      job.status = 'COMMITTED';
      for (var i = 0; i < job.counts.accepted; i++) {
        DB.items.push({ id: uid('item'), name: 'Item importado ' + (i + 1), category: 'Importado', dueDate: addDays(TODAY, 60 + i), status: 'ACTIVE', assignee: '(importado)', version: 1 });
      }
      render();
      announce('Importação concluída: ' + job.counts.accepted + ' registros criados.');
    }, 600);
  };
  actions.reconcileImport = function (el) {
    var job = DB.importJobs[el.getAttribute('data-job')];
    job.status = 'COMMITTED';
    render();
    announce('Reconsulta confirmou: importação concluída.');
  };

  // =======================================================================
  // SURF-016 — Settings
  // =======================================================================
  route('/settings', function () {
    var s = DB.settings;
    var body = '<form novalidate data-form="saveSettings">' +
      '<div class="field"><label><input type="checkbox" name="emailEnabled"' + (s.emailEnabled ? ' checked' : '') + '> Receber alertas por e-mail</label></div>' +
      '<div class="field"><label for="s-locale">Idioma</label><select id="s-locale" name="locale"><option' + (s.locale === 'pt-BR' ? ' selected' : '') + '>pt-BR</option></select></div>' +
      '<div class="field"><span id="quiet-label">Não perturbar</span> ' +
      '<label for="s-quiet-start" style="display:inline">das</label> <input id="s-quiet-start" name="quietStart" type="time" aria-describedby="quiet-label" value="' + s.quietStart + '" style="width:100px;display:inline-block"> ' +
      '<label for="s-quiet-end" style="display:inline">às</label> <input id="s-quiet-end" name="quietEnd" type="time" aria-describedby="quiet-label" value="' + s.quietEnd + '" style="width:100px;display:inline-block"></div>' +
      '<div class="field"><label><input type="radio" name="delivery" value="auto"' + (s.deliveryPreference === 'auto' ? ' checked' : '') + '> Enviar automaticamente por e-mail</label>' +
      '<label><input type="radio" name="delivery" value="manual"' + (s.deliveryPreference === 'manual' ? ' checked' : '') + '> Eu mesmo envio o link manualmente</label></div>' +
      '<div class="actions"><button type="submit" class="btn btn-primary">Salvar</button></div></form><div id="settings-fb"></div>';
    return shell('Configurações', '', body, { navKey: 'settings' });
  });
  actions.saveSettings = function (form) {
    DB.settings.emailEnabled = !!form.querySelector('[name=emailEnabled]').checked;
    DB.settings.deliveryPreference = form.querySelector('[name=delivery]:checked').value;
    document.getElementById('settings-fb').innerHTML = feedback('success', '✓', 'Preferências salvas.');
    announce('Preferências salvas.');
  };

  // =======================================================================
  // SURF-017 — Session Recovery
  // =======================================================================
  route('/session-expired', function () {
    var body = '<p>Sua sessão expirou.</p>' +
      (SESSION.pendingReturn ? '<p>Ao entrar novamente, você voltará exatamente para onde estava.</p>' : '<p>Dados não confirmados de formulários curtos podem não ser preservados (journey curta, aceitável).</p>') +
      '<div class="actions"><button class="btn btn-primary" data-action="reauthenticate">Entrar novamente</button></div>';
    return shell('Sessão Expirada', '', body, { noNav: true, a11y: 'foco previsível ao retornar; nenhuma perda de trabalho não confirmado além do já aceito nas etapas anteriores.' });
  });
  actions.reauthenticate = function () {
    SESSION.authenticated = true;
    var back = SESSION.pendingReturn;
    SESSION.pendingReturn = null;
    announce('Sessão restaurada.');
    if (back) { location.hash = back; render(); } else { navigate('#/overview'); }
  };
  function expireSessionNow() {
    SESSION.pendingReturn = location.hash;
    SESSION.authenticated = false;
    render();
    announce('(prototype-only) Sessão expirada simulada.');
  }

  // ---------------------------------------------------------------------
  // Prototype Scenario Control bar
  // ---------------------------------------------------------------------
  var JOURNEYS = {
    'J-01': { label: 'J-01 — Revisão Operacional', scenarios: [
      { id: 'PROTO-J01-HAPPY', desc: 'Overview com vencidos e vencendo em breve.', run: function () { resetAll(); } },
      { id: 'PROTO-J01-EMPTY', desc: 'Overview sem nenhum vencimento (EMPTY_TRUE).', run: function () { resetAll(); DB.items = []; navigate('#/overview'); } },
      { id: 'PROTO-J01-LOAD-FAIL', desc: 'Falha ao carregar a Overview (distinta de vazio).', run: function () { resetAll(); FLAGS.overviewLoadError = true; render(); } }
    ]},
    'J-02': { label: 'J-02 — Criar Vencimento', scenarios: [
      { id: 'PROTO-J02-SUCCESS', desc: 'Preencha e envie — criação confirmada.', run: function () { resetAll(); navigate('#/items/new'); } },
      { id: 'PROTO-J02-VALIDATION', desc: 'Envie o formulário em branco — erro por campo.', run: function () { resetAll(); navigate('#/items/new'); } },
      { id: 'PROTO-J02-UNKNOWN', desc: 'Preencha e envie — resultado incerto (CREATE-IDEMPOTENCY-01), sem retry automático.', run: function () { resetAll(); FLAGS.createOutcome = 'unknown'; navigate('#/items/new'); } }
    ]},
    'J-03': { label: 'J-03 — Renovar Vencimento', scenarios: [
      { id: 'PROTO-J03-HAPPY', desc: 'Renove o Certificado Digital A1 — sucesso com dual claim.', run: function () { resetAll(); navigate('#/items/item-3?from=items'); } },
      { id: 'PROTO-J03-CONFLICT', desc: 'Tente renovar — CONFLICT (mudança concorrente simulada).', run: function () { resetAll(); FLAGS.forceConflictOnNextMutation = true; navigate('#/items/item-3/renew'); } },
      { id: 'PROTO-J03-SOURCE-CHANGED', desc: 'Tente renovar um item já arquivado.', run: function () { resetAll(); findItem('item-3').status = 'ARCHIVED'; navigate('#/items/item-3/renew'); } },
      { id: 'PROTO-J03-UNKNOWN', desc: 'Renove — resultado incerto, reconsulta automática segura.', run: function () { resetAll(); FLAGS.renewOutcome = 'unknown'; navigate('#/items/item-3/renew'); } }
    ]},
    'J-04': { label: 'J-04 — Evidência Documental', scenarios: [
      { id: 'PROTO-J04-HAPPY', desc: 'Envie um documento — teto real de observabilidade (BLOCKER-A).', run: function () { resetAll(); navigate('#/items/item-3/document'); } },
      { id: 'PROTO-J04-NETWORK-FAIL', desc: 'Envio falha por rede — resultado incerto, nova reserva.', run: function () { resetAll(); FLAGS.uploadOutcome = 'networkFail'; navigate('#/items/item-3/document'); } },
      { id: 'PROTO-J04-REENTRY', desc: 'Envie, depois saia e volte — observe que o "upload enviado" não sobrevive (BLOCKER-A honesto).', run: function () { resetAll(); navigate('#/items/item-3/document'); } }
    ]},
    'J-05': { label: 'J-05 — Alerta (BLOCKER-B)', scenarios: [
      { id: 'PROTO-J05-HAPPY', desc: 'Configure um alerta — teto real: POLICY_CONFIGURED, nunca "você será avisado".', run: function () { resetAll(); navigate('#/items/item-3/alert'); } },
      { id: 'PROTO-J05-VALIDATION', desc: 'Tente salvar com offset inválido.', run: function () { resetAll(); navigate('#/items/item-3/alert'); } }
    ]},
    'J-06': { label: 'J-06 — Coleta Externa', scenarios: [
      { id: 'PROTO-J06-HAPPY', desc: 'Percorra requisito → solicitação → acompanhamento (use os botões PROTOTYPE-ONLY para avançar o status).', run: function () { resetAll(); navigate('#/subjects/subj-1/requirements/req-1'); } },
      { id: 'PROTO-J06-A', desc: 'Branch point — Variante A (fechamento automático).', run: function () { resetAll(); findDocRequest('dr-1').status = 'SUBMITTED'; navigate('#/submission-review?variant=a&dr=dr-1'); } },
      { id: 'PROTO-J06-B', desc: 'Branch point — Variante B (revisão humana).', run: function () { resetAll(); findDocRequest('dr-1').status = 'SUBMITTED'; navigate('#/submission-review?variant=b&dr=dr-1'); } },
      { id: 'PROTO-J06-REVOKE', desc: 'Revogar uma solicitação (alta consequência).', run: function () { resetAll(); navigate('#/requests/dr-1'); } }
    ]},
    'J-07': { label: 'J-07 — Guest Submission', scenarios: [
      { id: 'PROTO-J07-HAPPY', desc: 'Link válido — visualizar pedido e enviar (GTR-01 anotado).', run: function () { resetAll(); navigate('#/guest/tok-valid'); } },
      { id: 'PROTO-J07-UNAVAILABLE-EXPIRED', desc: 'Token expirado — mesma tela genérica.', run: function () { resetAll(); navigate('#/guest/tok-expired'); } },
      { id: 'PROTO-J07-UNAVAILABLE-REVOKED', desc: 'Token revogado — mesma tela genérica.', run: function () { resetAll(); navigate('#/guest/tok-revoked'); } },
      { id: 'PROTO-J07-UNAVAILABLE-NOTFOUND', desc: 'Token inexistente — mesma tela genérica.', run: function () { resetAll(); navigate('#/guest/tok-does-not-exist'); } },
      { id: 'PROTO-J07-NETWORK-FAIL', desc: 'Envio falha por rede — reenvio seguro oferecido.', run: function () { resetAll(); FLAGS.guestUploadOutcome = 'networkFail'; navigate('#/guest/tok-valid'); } },
      { id: 'PROTO-J07-FILE-INVALID', desc: 'Selecione um arquivo .txt ou maior que 10MB — validação client-side antes de qualquer envio (FileSelected com erro).', run: function () { resetAll(); navigate('#/guest/tok-valid'); } },
      { id: 'PROTO-J07-MOBILE', desc: 'Mesmo fluxo feliz, com viewport mobile simulado.', run: function () { resetAll(); setMobile(true); navigate('#/guest/tok-valid'); } }
    ]},
    'J-08': { label: 'J-08 — Importação em Massa', scenarios: [
      { id: 'PROTO-J08-HAPPY', desc: 'Selecione um arquivo e percorra até o commit.', run: function () { resetAll(); navigate('#/import'); } },
      { id: 'PROTO-J08-PARSE-FAILED', desc: 'CSV malformado — falha, sem retomar job morto.', run: function () { resetAll(); FLAGS.importOutcome = 'parseFailed'; navigate('#/import'); } },
      { id: 'PROTO-J08-UNKNOWN', desc: 'Commit com resultado incerto — reconsulta idempotente.', run: function () { resetAll(); FLAGS.importOutcome = 'unknown'; navigate('#/import'); } },
      { id: 'PROTO-J08-EXPIRED', desc: 'Job expira sem confirmação — distinto de FAILED, não retomável.', run: function () { resetAll(); FLAGS.importOutcome = 'expired'; navigate('#/import'); } },
      { id: 'PROTO-J08-REENTRY', desc: 'Inicie o import, deixe em PARSING, e reabra a rota — estado é recuperado (contraste com BLOCKER-A).', run: function () { resetAll(); navigate('#/import'); } }
    ]},
    'CROSS': { label: 'Cross-cutting (sessão / OCC)', scenarios: [
      { id: 'PROTO-SESSION-DURING-CREATE', desc: 'Vá para Novo Vencimento e clique "Expirar sessão agora".', run: function () { resetAll(); navigate('#/items/new'); } },
      { id: 'PROTO-SESSION-DURING-IMPORT', desc: 'Inicie um import e expire a sessão — o progresso persistido é recuperável ao reautenticar.', run: function () { resetAll(); navigate('#/import'); } },
      { id: 'PROTO-EXPIRE-SESSION-NOW', desc: 'Expira a sessão a partir de onde você estiver agora.', run: function () { expireSessionNow(); } }
    ]}
  };

  function setMobile(on) {
    document.getElementById('app-shell').classList.toggle('mobile-sim', on);
    document.getElementById('ctl-mobile').setAttribute('aria-pressed', String(on));
  }

  function renderScenarioButtons() {
    var journeySel = document.getElementById('ctl-journey');
    var box = document.getElementById('ctl-scenarios');
    if (!journeySel || !box || !JOURNEYS[journeySel.value]) return; // control bar not booted yet — defensive, see boot order note above
    var key = journeySel.value;
    box.innerHTML = '';
    JOURNEYS[key].scenarios.forEach(function (sc) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = sc.id;
      b.title = sc.desc;
      b.addEventListener('click', function () { sc.run(); });
      box.appendChild(b);
    });
    var d = document.createElement('div');
    d.className = 'scenario-desc';
    d.textContent = 'Passe o mouse/foco num botão de cenário para ver a descrição (title).';
    box.appendChild(d);
  }

  function bootControlBar() {
    var journeySel = document.getElementById('ctl-journey');
    Object.keys(JOURNEYS).forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k; opt.textContent = JOURNEYS[k].label;
      journeySel.appendChild(opt);
    });
    journeySel.addEventListener('change', renderScenarioButtons);
    document.getElementById('ctl-reset').addEventListener('click', resetAll);
    document.getElementById('ctl-mobile').addEventListener('click', function () {
      setMobile(!document.getElementById('app-shell').classList.contains('mobile-sim'));
    });
    document.getElementById('ctl-collapse').addEventListener('click', function () {
      var bar = document.getElementById('control-bar');
      var collapsed = bar.classList.toggle('collapsed');
      this.setAttribute('aria-expanded', String(!collapsed));
      this.textContent = collapsed ? 'Show ▸' : 'Hide ▾';
    });
    renderScenarioButtons();
  }

  // ---------------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------------
  window.addEventListener('hashchange', render);
  document.addEventListener('DOMContentLoaded', function () {
    bootControlBar(); // must populate the journey <select> before the first render() call
    resetAll();
  });
})();
