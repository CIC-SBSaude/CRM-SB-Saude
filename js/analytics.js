/* Construtor local de análises sobre as propostas do CRM. */
(function (root) {
  'use strict';

  const DIMENSIONS = [
    { id: 'COMPETENCIA', label: 'Competência', date: true },
    { id: 'DATA_DA_PROSPECCAO', label: 'Mês da prospecção', date: true },
    { id: 'TEMPERATURA_CONTRATO', label: 'Etapa do contrato' },
    { id: 'UF', label: 'Estado (UF)' },
    { id: 'CORRETORES_1', label: 'Corretor principal' },
    { id: 'PLANO_CAMPANHA', label: 'Campanha' },
    { id: 'EMPRESA', label: 'Empresa' },
    { id: 'ACOMODACAO', label: 'Acomodação' },
    { id: 'FATOR_MODERADOR', label: 'Fator moderador' },
    { id: 'Tipo_Contrato', label: 'Tipo de contrato' },
    { id: 'Aptidao', label: 'Aptidão' },
    { id: 'Usuario', label: 'Responsável' }
  ];
  const COLUMN_IDS = ['TEMPERATURA_CONTRATO', 'UF', 'ACOMODACAO', 'FATOR_MODERADOR', 'Tipo_Contrato', 'Aptidao', 'Usuario', 'COMPETENCIA'];
  const MEASURES = [
    { id: 'count', label: 'Quantidade de propostas', kind: 'count' },
    { id: 'lives', label: 'Total de vidas', field: 'VIDAS', kind: 'sum' },
    { id: 'revenue', label: 'Faturamento total', field: 'FATURAMENTO', kind: 'sum', currency: true },
    { id: 'avgLives', label: 'Média de vidas', field: 'VIDAS', kind: 'avg' },
    { id: 'avgRevenue', label: 'Faturamento médio', field: 'FATURAMENTO', kind: 'avg', currency: true },
    { id: 'avgTkm', label: 'TKM médio', field: 'TKM', kind: 'avg', currency: true }
  ];
  const DEFAULT = { row: 'COMPETENCIA', column: '', measure: 'revenue', chart: 'bar', sort: 'value-desc', filters: [] };
  const COLORS = ['#be123c', '#2563eb', '#059669', '#d97706', '#7c3aed', '#0891b2', '#ea580c', '#475569', '#db2777', '#65a30d', '#4f46e5', '#0f766e'];
  let chartInstance = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function number(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value || '').replace(/[^\d,.-]/g, '');
    if (!raw) return 0;
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/\.(?=\d{3}(?:\D|$))/g, '');
    return Number(normalized) || 0;
  }

  function dimensionValue(record, id) {
    if (!id) return '';
    let value = String(record[id] ?? '').trim();
    if (!value) return '(Não informado)';
    const field = DIMENSIONS.find(item => item.id === id);
    if (field && field.date) {
      let match = value.match(/^\d{2}[-/](\d{2})[-/](\d{4})/);
      if (match) return `${match[2]}-${match[1]}`;
      match = value.match(/^(\d{4})-(\d{2})/);
      if (match) return `${match[1]}-${match[2]}`;
    }
    return value;
  }

  function validConfig(input) {
    const source = input || {};
    return {
      row: DIMENSIONS.some(d => d.id === source.row) ? source.row : DEFAULT.row,
      column: COLUMN_IDS.includes(source.column) && source.column !== source.row ? source.column : '',
      measure: MEASURES.some(m => m.id === source.measure) ? source.measure : DEFAULT.measure,
      chart: ['bar', 'line', 'doughnut'].includes(source.chart) ? source.chart : DEFAULT.chart,
      sort: ['value-desc', 'value-asc', 'label-asc', 'label-desc'].includes(source.sort) ? source.sort : DEFAULT.sort,
      filters: Array.isArray(source.filters) ? source.filters.filter(f => DIMENSIONS.some(d => d.id === f.field) && typeof f.value === 'string').slice(0, 12) : []
    };
  }

  function build(proposals, rawConfig) {
    const config = validConfig(rawConfig);
    const measure = MEASURES.find(m => m.id === config.measure);
    const filtered = proposals.filter(record => config.filters.every(f => dimensionValue(record, f.field) === f.value));
    const matrix = new Map();
    const columnSet = new Set();
    for (const record of filtered) {
      const row = dimensionValue(record, config.row);
      const column = config.column ? dimensionValue(record, config.column) : '';
      columnSet.add(column);
      if (!matrix.has(row)) matrix.set(row, new Map());
      const cells = matrix.get(row);
      if (!cells.has(column)) cells.set(column, { sum: 0, count: 0 });
      const cell = cells.get(column);
      cell.count++;
      cell.sum += measure.kind === 'count' ? 1 : number(record[measure.field]);
    }
    const columns = Array.from(columnSet).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    const value = cell => !cell ? 0 : measure.kind === 'avg' ? cell.sum / cell.count : cell.sum;
    const combine = cells => {
      let sum = 0, count = 0;
      for (const cell of cells) { sum += cell.sum; count += cell.count; }
      return value({ sum, count });
    };
    const rows = Array.from(matrix, ([label, cells]) => ({
      label,
      values: columns.map(col => value(cells.get(col))),
      total: combine(cells.values()),
      count: Array.from(cells.values()).reduce((n, cell) => n + cell.count, 0)
    }));
    rows.sort((a, b) => {
      if (config.sort === 'label-asc') return a.label.localeCompare(b.label, 'pt-BR', { numeric: true });
      if (config.sort === 'label-desc') return b.label.localeCompare(a.label, 'pt-BR', { numeric: true });
      return config.sort === 'value-asc' ? a.total - b.total : b.total - a.total;
    });
    const columnTotals = columns.map(col => combine(Array.from(matrix.values(), cells => cells.get(col)).filter(Boolean)));
    const grandTotal = combine(Array.from(matrix.values()).flatMap(cells => Array.from(cells.values())));
    return { config, measure, rows, columns, columnTotals, grandTotal, filteredCount: filtered.length };
  }

  function format(value, measure) {
    return new Intl.NumberFormat('pt-BR', measure.currency ? { style: 'currency', currency: 'BRL' } : { maximumFractionDigits: measure.kind === 'avg' ? 2 : 0 }).format(value);
  }

  function options(items, selected, emptyLabel) {
    return (emptyLabel == null ? '' : `<option value="">${escapeHtml(emptyLabel)}</option>`) + items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
  }

  function storageKey(user) { return `crm_analytics_views_v1_${String(user || 'local').replace(/[^\w.-]/g, '_')}`; }
  function readViews(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.filter(v => v && typeof v.name === 'string' && v.config).slice(0, 30) : [];
    } catch (_) { return []; }
  }
  function writeViews(key, views) { localStorage.setItem(key, JSON.stringify(views)); }

  function csvCell(value) {
    let text = String(value == null ? '' : value);
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function toCsv(result) {
    const rowLabel = DIMENSIONS.find(d => d.id === result.config.row).label;
    const lines = [[rowLabel, ...result.columns.filter(Boolean), 'Total']];
    result.rows.forEach(row => lines.push([row.label, ...(result.config.column ? row.values : []), row.total]));
    lines.push(['Total geral', ...(result.config.column ? result.columnTotals : []), result.grandTotal]);
    return '\uFEFF' + lines.map(line => line.map(csvCell).join(';')).join('\r\n');
  }

  function mount(container, proposals, user) {
    const key = storageKey(user);
    let config = validConfig(DEFAULT);
    let views = readViews(key);
    let activeView = '';
    let filterField = 'TEMPERATURA_CONTRATO';
    let filterValue = '';

    function drawChart(result) {
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      const canvas = container.querySelector('#analytics-chart');
      if (!canvas || typeof root.Chart === 'undefined' || !result.rows.length) return;
      const chartRows = result.rows.slice(0, 15);
      const multi = !!config.column && config.chart !== 'doughnut';
      const datasets = multi ? result.columns.map((col, i) => ({
        label: col,
        data: chartRows.map(row => row.values[i]),
        backgroundColor: COLORS[i % COLORS.length],
        borderColor: COLORS[i % COLORS.length],
        borderWidth: config.chart === 'line' ? 2 : 0
      })) : [{
        label: result.measure.label,
        data: chartRows.map(row => row.total),
        backgroundColor: config.chart === 'doughnut' ? chartRows.map((_, i) => COLORS[i % COLORS.length]) : COLORS[0],
        borderColor: COLORS[0],
        borderWidth: config.chart === 'line' ? 2 : 0
      }];
      const isDark = typeof document !== 'undefined' && document.documentElement && document.documentElement.getAttribute('data-theme') === 'dark';
      const textColor = isDark ? '#94a3b8' : '#64748b';
      const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : '#f1f5f9';

      chartInstance = new root.Chart(canvas, {
        type: config.chart,
        data: { labels: chartRows.map(row => row.label), datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: multi || config.chart === 'doughnut',
              position: 'bottom',
              labels: {
                color: isDark ? '#cbd5e1' : '#475569',
                font: { family: 'Inter', size: 11 }
              }
            },
            tooltip: {
              backgroundColor: isDark ? '#1e293b' : '#0f172a',
              borderColor: isDark ? '#334155' : '#0f172a',
              borderWidth: isDark ? 1 : 0,
              titleColor: '#ffffff',
              bodyColor: isDark ? '#cbd5e1' : '#f8fafc'
            }
          },
          scales: config.chart === 'doughnut' ? {} : {
            x: {
              grid: { color: gridColor },
              ticks: { color: textColor, font: { family: 'Inter', size: 10 } }
            },
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: { color: textColor, font: { family: 'Inter', size: 10 } }
            }
          }
        }
      });
    }

    function render() {
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      const result = build(proposals, config);
      const availableValues = Array.from(new Set(proposals.map(p => dimensionValue(p, filterField)))).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
      if (!availableValues.includes(filterValue)) filterValue = availableValues[0] || '';
      const rowLabel = DIMENSIONS.find(d => d.id === config.row).label;
      const visibleRows = result.rows.slice(0, 100);
      container.innerHTML = `
        <div class="analytics-page">
          <div class="analytics-heading"><div><p class="analytics-eyebrow">INTELIGÊNCIA COMERCIAL</p><h2>Análises dinâmicas</h2><p>Monte gráficos e tabelas dinâmicas com os dados de propostas da carteira.</p></div></div>
          <div class="analytics-toolbar">
            <label>Visualização salva<select id="an-view"><option value="">Nova análise</option>${views.map(v => `<option value="${escapeHtml(v.name)}" ${v.name === activeView ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}</select></label>
            <label>Nome da análise<input id="an-name" maxlength="60" value="${escapeHtml(activeView)}" placeholder="Ex.: Faturamento por estado"></label>
            <button type="button" id="an-save" class="an-primary">Salvar análise</button>
            <button type="button" id="an-delete" ${activeView ? '' : 'disabled'}>Excluir</button>
            <button type="button" id="an-reset">Limpar</button>
          </div>
          <div class="analytics-builder">
            <label>Linhas<select id="an-row">${options(DIMENSIONS, config.row)}</select></label>
            <label>Colunas<select id="an-column">${options(DIMENSIONS.filter(d => COLUMN_IDS.includes(d.id) && d.id !== config.row), config.column, 'Sem colunas')}</select></label>
            <label>Medida<select id="an-measure">${options(MEASURES, config.measure)}</select></label>
            <label>Gráfico<select id="an-chart">${options([{id:'bar',label:'Barras'},{id:'line',label:'Linhas'},{id:'doughnut',label:'Rosca'}],config.chart)}</select></label>
            <label>Ordenar<select id="an-sort">${options([{id:'value-desc',label:'Maior valor'},{id:'value-asc',label:'Menor valor'},{id:'label-asc',label:'Nome A–Z'},{id:'label-desc',label:'Nome Z–A'}],config.sort)}</select></label>
          </div>
          <div class="analytics-filter-bar">
            <strong>Filtros</strong>
            <select id="an-filter-field" aria-label="Campo do filtro">${options(DIMENSIONS, filterField)}</select>
            <select id="an-filter-value" aria-label="Valor do filtro">${availableValues.map(v => `<option value="${escapeHtml(v)}" ${v === filterValue ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select>
            <button type="button" id="an-add-filter" ${availableValues.length ? '' : 'disabled'}>+ Adicionar</button>
            <div class="analytics-chips">${config.filters.map((f, i) => `<button type="button" class="an-chip" data-remove-filter="${i}" title="Remover filtro">${escapeHtml(DIMENSIONS.find(d => d.id === f.field).label)}: ${escapeHtml(f.value)} ×</button>`).join('')}</div>
          </div>
          <div class="analytics-summary"><strong>${result.filteredCount.toLocaleString('pt-BR')}</strong> propostas · <strong>${result.rows.length.toLocaleString('pt-BR')}</strong> grupos · <strong>${escapeHtml(result.measure.label)}:</strong> ${escapeHtml(format(result.grandTotal, result.measure))}</div>
          <div class="analytics-card"><div class="analytics-card-head"><div><h3>Gráfico</h3><p>Exibe até 15 grupos. A tabela e o CSV contêm todos os grupos.</p></div></div>${result.rows.length ? '<div class="analytics-canvas"><canvas id="analytics-chart" aria-label="Gráfico da análise"></canvas></div>' : '<p class="analytics-empty">Nenhum dado corresponde aos filtros selecionados.</p>'}</div>
          <div class="analytics-card"><div class="analytics-card-head"><div><h3>Tabela dinâmica</h3><p>${result.rows.length > 100 ? 'Mostrando os primeiros 100 grupos. Exporte o CSV para consultar todos.' : 'Valores recalculados conforme os campos e filtros selecionados.'}</p></div><button type="button" id="an-export" class="an-primary">Exportar CSV</button></div>
          <div class="analytics-table-wrap"><table class="analytics-table"><thead><tr><th scope="col">${escapeHtml(rowLabel)}</th>${result.columns.filter(Boolean).map(col => `<th scope="col">${escapeHtml(col)}</th>`).join('')}<th scope="col">Total</th></tr></thead><tbody>${visibleRows.map(row => `<tr><th scope="row">${escapeHtml(row.label)}</th>${(config.column ? row.values : []).map(v => `<td>${escapeHtml(format(v,result.measure))}</td>`).join('')}<td>${escapeHtml(format(row.total,result.measure))}</td></tr>`).join('')}${!visibleRows.length ? `<tr><td colspan="${result.columns.length + 1}">Nenhum resultado</td></tr>` : ''}</tbody><tfoot><tr><th>Total geral</th>${(config.column ? result.columnTotals : []).map(v => `<td>${escapeHtml(format(v,result.measure))}</td>`).join('')}<td>${escapeHtml(format(result.grandTotal,result.measure))}</td></tr></tfoot></table></div></div>
        </div>`;
      drawChart(result);
      ['row', 'column', 'measure', 'chart', 'sort'].forEach(field => container.querySelector(`#an-${field}`).addEventListener('change', e => {
        config[field] = e.target.value;
        config = validConfig(config);
        render();
      }));
      container.querySelector('#an-filter-field').addEventListener('change', e => { filterField = e.target.value; filterValue = ''; render(); });
      container.querySelector('#an-filter-value').addEventListener('change', e => { filterValue = e.target.value; });
      container.querySelector('#an-add-filter').addEventListener('click', () => {
        if (filterValue && !config.filters.some(f => f.field === filterField && f.value === filterValue)) config.filters.push({ field: filterField, value: filterValue });
        render();
      });
      container.querySelectorAll('[data-remove-filter]').forEach(btn => btn.addEventListener('click', () => { config.filters.splice(Number(btn.dataset.removeFilter), 1); render(); }));
      container.querySelector('#an-view').addEventListener('change', e => {
        activeView = e.target.value;
        config = activeView ? validConfig(views.find(v => v.name === activeView)?.config) : validConfig(DEFAULT);
        render();
      });
      container.querySelector('#an-save').addEventListener('click', () => {
        const name = container.querySelector('#an-name').value.trim();
        if (!name) { alert('Digite um nome para a análise.'); return; }
        const existing = views.findIndex(v => v.name === name);
        if (existing < 0 && views.length >= 30) { alert('Limite de 30 análises salvas. Exclua uma para continuar.'); return; }
        if (existing >= 0) views[existing] = { name, config: validConfig(config) };
        else views.push({ name, config: validConfig(config) });
        try { writeViews(key, views); activeView = name; render(); }
        catch (_) { alert('Não foi possível salvar no navegador. Verifique o espaço disponível.'); }
      });
      container.querySelector('#an-delete').addEventListener('click', () => {
        if (!activeView) return;
        views = views.filter(v => v.name !== activeView);
        try { writeViews(key, views); activeView = ''; render(); }
        catch (_) { alert('Não foi possível excluir a análise salva.'); }
      });
      container.querySelector('#an-reset').addEventListener('click', () => { activeView = ''; config = validConfig(DEFAULT); render(); });
      container.querySelector('#an-export').addEventListener('click', () => {
        const blob = new Blob([toCsv(result)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `analise-crm-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    }
    render();
  }

  function unmount() {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  }

  const api = { mount, unmount, build, toCsv, number, dimensionValue, validConfig };
  root.CRMAnalytics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
