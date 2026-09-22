/**
 * CRM SB Saúde — Motor Unificado de Relatórios e Consultas
 * Suporte universal (Browser e Node.js) para extração, filtragem combinada,
 * agrupamento, cálculo de medidas, modelos sugeridos, persistência e exportação.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReportsEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Chaves de armazenamento
  const STORAGE_SAVED_REPORTS_KEY = 'crm_saved_reports_v1';

  // Normalização e Formatação pt-BR
  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value === null || value === undefined) return 0;
    const raw = String(value).replace(/[^\d,.-]/g, '').trim();
    if (!raw) return 0;
    // Se possui vírgula, assume padrão pt-BR
    const normalized = raw.includes(',')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/\.(?=\d{3}(?:\D|$))/g, '');
    const num = parseFloat(normalized);
    return Number.isFinite(num) ? num : 0;
  }

  function parseCurrency(value) {
    return parseNumber(value);
  }

  function formatCurrency(value) {
    const num = parseNumber(value);
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatNumber(value, decimals = 0) {
    const num = parseNumber(value);
    return num.toLocaleString('pt-BR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function parseDateBR(str) {
    if (!str) return null;
    const clean = String(str).trim();
    // Padrão DD/MM/AAAA ou DD-MM-AAAA
    const matchBR = clean.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (matchBR) {
      const day = parseInt(matchBR[1], 10);
      const month = parseInt(matchBR[2], 10) - 1;
      const year = parseInt(matchBR[3], 10);
      const d = new Date(year, month, day);
      return isNaN(d.getTime()) ? null : d;
    }
    // Padrão AAAA-MM-DD
    const matchISO = clean.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (matchISO) {
      const year = parseInt(matchISO[1], 10);
      const month = parseInt(matchISO[2], 10) - 1;
      const day = parseInt(matchISO[3], 10);
      const d = new Date(year, month, day);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  function formatDateBR(dateVal) {
    if (!dateVal) return '—';
    if (typeof dateVal === 'string') {
      const parsed = parseDateBR(dateVal);
      if (parsed) {
        const d = String(parsed.getDate()).padStart(2, '0');
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const y = parsed.getFullYear();
        return `${d}/${m}/${y}`;
      }
      return dateVal;
    }
    if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
      const d = String(dateVal.getDate()).padStart(2, '0');
      const m = String(dateVal.getMonth() + 1).padStart(2, '0');
      const y = dateVal.getFullYear();
      return `${d}/${m}/${y}`;
    }
    return '—';
  }

  // Definição dos Esquemas das Fontes de Dados
  const DATA_SOURCES = {
    proposals: {
      key: 'proposals',
      label: 'Propostas Comerciais',
      description: 'Base de cotações, prospecções e contratos do CRM (1.072 registros)',
      requiresMaster: false,
      dateField: 'DATA_DA_PROSPECCAO',
      columns: [
        { id: 'ID', label: 'ID Proposta', type: 'text', defaultSelected: true },
        { id: 'DATA_DA_PROSPECCAO', label: 'Data Prospecção', type: 'date', defaultSelected: true },
        { id: 'EMPRESA', label: 'Empresa', type: 'text', defaultSelected: true },
        { id: 'CNPJ', label: 'CNPJ', type: 'text' },
        { id: 'COMPETENCIA', label: 'Competência', type: 'date', defaultSelected: true },
        { id: 'VIDAS', label: 'Vidas', type: 'number', defaultSelected: true },
        { id: 'CIDADE', label: 'Cidade', type: 'text' },
        { id: 'UF', label: 'Estado (UF)', type: 'text', defaultSelected: true },
        { id: 'TKM', label: 'TKM (Ticket Médio)', type: 'currency' },
        { id: 'FATURAMENTO', label: 'Faturamento', type: 'currency', defaultSelected: true },
        { id: 'TEMPERATURA_CONTRATO', label: 'Etapa / Temperatura', type: 'badge', defaultSelected: true },
        { id: 'CORRETORES_1', label: 'Corretor Principal', type: 'text', defaultSelected: true },
        { id: 'CORRETORES_2', label: 'Corretor Secundário', type: 'text' },
        { id: 'ACOMODACAO', label: 'Acomodação', type: 'text' },
        { id: 'FATOR_MODERADOR', label: 'Fator Moderador', type: 'text' },
        { id: 'POLITICA_COPARTICIPACAO', label: 'Política Coparticipação', type: 'text' },
        { id: 'PLANO_CAMPANHA', label: 'Campanha', type: 'text' },
        { id: 'Status_Campanha', label: 'Status Campanha', type: 'text' },
        { id: 'Tipo_Contrato', label: 'Tipo de Contrato', type: 'text' },
        { id: 'Aptidao', label: 'Aptidão', type: 'text' },
        { id: 'Usuario', label: 'Responsável', type: 'text' },
        { id: 'Motivo_Declinio', label: 'Motivo Declínio / Desistência', type: 'text' },
        { id: 'Observacao', label: 'Observação', type: 'text' }
      ]
    },
    companies: {
      key: 'companies',
      label: 'Empresas / Clientes',
      description: 'Empresas prospectadas com métricas consolidadas',
      requiresMaster: false,
      dateField: 'ULTIMA_PROSPECCAO',
      columns: [
        { id: 'EMPRESA', label: 'Nome da Empresa', type: 'text', defaultSelected: true },
        { id: 'CNPJ', label: 'CNPJ', type: 'text', defaultSelected: true },
        { id: 'UF', label: 'Estado (UF)', type: 'text', defaultSelected: true },
        { id: 'PLANO_CAMPANHA', label: 'Campanha Mais Recente', type: 'text' },
        { id: 'CORRETORES', label: 'Corretores Vinculados', type: 'text' },
        { id: 'QNT_PROPOSTAS', label: 'Qtd Propostas', type: 'number', defaultSelected: true },
        { id: 'TOTAL_VIDAS', label: 'Total de Vidas', type: 'number', defaultSelected: true },
        { id: 'TOTAL_FATURAMENTO', label: 'Faturamento Total', type: 'currency', defaultSelected: true },
        { id: 'ULTIMA_PROSPECCAO', label: 'Última Prospecção', type: 'date', defaultSelected: true }
      ]
    },
    brokers: {
      key: 'brokers',
      label: 'Corretores & Parceiros',
      description: 'Rede comercial de corretores e desempenho de vendas',
      requiresMaster: false,
      columns: [
        { id: 'NOME_CORRETOR', label: 'Nome do Corretor', type: 'text', defaultSelected: true },
        { id: 'TOTAL_PROPOSTAS', label: 'Total Propostas', type: 'number', defaultSelected: true },
        { id: 'CONTRATOS_FECHADOS', label: 'Contratos Fechados', type: 'number', defaultSelected: true },
        { id: 'TAXA_CONVERSAO', label: 'Taxa de Conversão (%)', type: 'number', defaultSelected: true },
        { id: 'TOTAL_VIDAS', label: 'Total de Vidas', type: 'number', defaultSelected: true },
        { id: 'TOTAL_FATURAMENTO', label: 'Faturamento Total', type: 'currency', defaultSelected: true },
        { id: 'TKM_MEDIO', label: 'TKM Médio', type: 'currency', defaultSelected: true }
      ]
    },
    campaigns: {
      key: 'campaigns',
      label: 'Campanhas Comerciais',
      description: 'Catálogo de campanhas e resultados por período',
      requiresMaster: false,
      columns: [
        { id: 'NOME_CAMPANHA', label: 'Nome da Campanha', type: 'text', defaultSelected: true },
        { id: 'STATUS', label: 'Status da Campanha', type: 'badge', defaultSelected: true },
        { id: 'COMPETENCIAS', label: 'Competências Vinculadas', type: 'text', defaultSelected: true },
        { id: 'TOTAL_PROPOSTAS', label: 'Total Propostas', type: 'number', defaultSelected: true },
        { id: 'TOTAL_VIDAS', label: 'Total de Vidas', type: 'number', defaultSelected: true },
        { id: 'TOTAL_FATURAMENTO', label: 'Faturamento Total', type: 'currency', defaultSelected: true },
        { id: 'TICKET_MEDIO', label: 'Ticket Médio (TKM)', type: 'currency', defaultSelected: true }
      ]
    },
    policies: {
      key: 'policies',
      label: 'Políticas Comerciais',
      description: 'Regulamentos de Coparticipação e Agenciamento',
      requiresMaster: false,
      columns: [
        { id: 'TIPO_POLITICA', label: 'Tipo de Política', type: 'text', defaultSelected: true },
        { id: 'NOME_POLITICA', label: 'Nome da Política', type: 'text', defaultSelected: true },
        { id: 'DESCONTO_EVENTO', label: 'Desconto Evento / Copart.', type: 'text', defaultSelected: true },
        { id: 'CONSULTA_ELETIVA', label: 'Consulta Eletiva', type: 'currency', defaultSelected: true },
        { id: 'CONSULTA_EMERGENCIA', label: 'Consulta Emergência', type: 'currency', defaultSelected: true },
        { id: 'EXAMES_SIMPLES', label: 'Exames Simples', type: 'currency', defaultSelected: true },
        { id: 'EXAMES_COMPLEXOS', label: 'Exames Complexos', type: 'currency', defaultSelected: true },
        { id: 'TERAPIA', label: 'Terapia', type: 'currency', defaultSelected: true }
      ]
    },
    audit: {
      key: 'audit',
      label: 'Auditoria & Governança',
      description: 'Logs de acessos corporativos e requisitos normativos (Acesso Exclusivo Master)',
      requiresMaster: true,
      columns: [
        { id: 'TIPO_REGISTRO', label: 'Tipo de Registro', type: 'text', defaultSelected: true },
        { id: 'IDENTIFICADOR', label: 'ID / Código', type: 'text', defaultSelected: true },
        { id: 'TITULO_ACAO', label: 'Ação / Requisito', type: 'text', defaultSelected: true },
        { id: 'USUARIO_MODULO', label: 'Usuário / Módulo', type: 'text', defaultSelected: true },
        { id: 'DATA_HORA', label: 'Data / Registro', type: 'text', defaultSelected: true },
        { id: 'STATUS_SEVERIDADE', label: 'Status / Severidade', type: 'badge', defaultSelected: true },
        { id: 'DETALHES', label: 'Detalhes Técnicos', type: 'text', defaultSelected: true }
      ]
    }
  };

  // Modelos Sugeridos de Relatórios
  const SUGGESTED_TEMPLATES = [
    {
      id: 'tpl-propostas-periodo-etapa',
      title: 'Propostas por Período e Etapa',
      description: 'Visão consolidada das propostas agrupadas por temperatura contratual com contagem, vidas e receita.',
      category: 'Comercial',
      icon: '📊',
      config: {
        source: 'proposals',
        columns: ['ID', 'DATA_DA_PROSPECCAO', 'EMPRESA', 'COMPETENCIA', 'VIDAS', 'FATURAMENTO', 'TEMPERATURA_CONTRATO', 'CORRETORES_1'],
        groupBy: 'TEMPERATURA_CONTRATO',
        measures: ['count', 'sum_VIDAS', 'sum_FATURAMENTO', 'avg_TKM'],
        filters: [],
        period: { start: '', end: '', field: 'DATA_DA_PROSPECCAO' },
        sort: { field: 'count', order: 'desc' }
      }
    },
    {
      id: 'tpl-faturamento-competencia',
      title: 'Faturamento por Competência',
      description: 'Evolução mensal do faturamento e número de vidas ao longo das competências comerciais.',
      category: 'Financeiro',
      icon: '💰',
      config: {
        source: 'proposals',
        columns: ['COMPETENCIA', 'VIDAS', 'FATURAMENTO', 'TKM'],
        groupBy: 'COMPETENCIA',
        measures: ['count', 'sum_VIDAS', 'sum_FATURAMENTO', 'avg_TKM'],
        filters: [],
        period: { start: '', end: '', field: 'COMPETENCIA' },
        sort: { field: 'COMPETENCIA', order: 'desc' }
      }
    },
    {
      id: 'tpl-propostas-corretor',
      title: 'Propostas por Corretor',
      description: 'Classificação da rede de corretores por volume de negócios, vidas e faturamento transacionado.',
      category: 'Parceiros',
      icon: '🤝',
      config: {
        source: 'proposals',
        columns: ['CORRETORES_1', 'VIDAS', 'FATURAMENTO', 'TEMPERATURA_CONTRATO'],
        groupBy: 'CORRETORES_1',
        measures: ['count', 'sum_VIDAS', 'sum_FATURAMENTO', 'avg_FATURAMENTO'],
        filters: [
          { field: 'CORRETORES_1', operator: 'is_not_empty', value: '' }
        ],
        period: { start: '', end: '', field: 'DATA_DA_PROSPECCAO' },
        sort: { field: 'sum_FATURAMENTO', order: 'desc' }
      }
    },
    {
      id: 'tpl-desempenho-campanhas',
      title: 'Desempenho de Campanhas',
      description: 'Análise de resultados gerados por cada campanha comercial cadastrada no CRM.',
      category: 'Estratégico',
      icon: '🎯',
      config: {
        source: 'proposals',
        columns: ['PLANO_CAMPANHA', 'VIDAS', 'FATURAMENTO', 'Status_Campanha'],
        groupBy: 'PLANO_CAMPANHA',
        measures: ['count', 'sum_VIDAS', 'sum_FATURAMENTO', 'avg_FATURAMENTO'],
        filters: [
          { field: 'PLANO_CAMPANHA', operator: 'is_not_empty', value: '' }
        ],
        period: { start: '', end: '', field: 'COMPETENCIA' },
        sort: { field: 'sum_FATURAMENTO', order: 'desc' }
      }
    },
    {
      id: 'tpl-distribuicao-estado',
      title: 'Distribuição por Estado (UF)',
      description: 'Geolocalização da carteira de propostas e concentração de vidas por unidade federativa.',
      category: 'Geográfico',
      icon: '🗺️',
      config: {
        source: 'proposals',
        columns: ['UF', 'VIDAS', 'FATURAMENTO', 'CIDADE'],
        groupBy: 'UF',
        measures: ['count', 'sum_VIDAS', 'sum_FATURAMENTO', 'avg_TKM'],
        filters: [
          { field: 'UF', operator: 'is_not_empty', value: '' }
        ],
        period: { start: '', end: '', field: 'DATA_DA_PROSPECCAO' },
        sort: { field: 'count', order: 'desc' }
      }
    },
    {
      id: 'tpl-vidas-empresa',
      title: 'Vidas por Empresa',
      description: 'Ranking de empresas com maior número de beneficiários e faturamento gerado.',
      category: 'Clientes',
      icon: '🏢',
      config: {
        source: 'proposals',
        columns: ['EMPRESA', 'UF', 'VIDAS', 'FATURAMENTO', 'TEMPERATURA_CONTRATO'],
        groupBy: 'EMPRESA',
        measures: ['count', 'sum_VIDAS', 'sum_FATURAMENTO'],
        filters: [],
        period: { start: '', end: '', field: 'DATA_DA_PROSPECCAO' },
        sort: { field: 'sum_VIDAS', order: 'desc' }
      }
    },
    {
      id: 'tpl-contratos-fechados',
      title: 'Contratos Fechados',
      description: 'Relação detalhada de propostas aprovadas com sucesso, empresas clientes e faturamento contratado.',
      category: 'Resultados',
      icon: '✅',
      config: {
        source: 'proposals',
        columns: ['ID', 'DATA_DA_PROSPECCAO', 'EMPRESA', 'CNPJ', 'VIDAS', 'FATURAMENTO', 'CORRETORES_1', 'ACOMODACAO', 'Tipo_Contrato'],
        groupBy: '', // Sem agrupamento: listagem analítica
        measures: [],
        filters: [
          { field: 'TEMPERATURA_CONTRATO', operator: 'eq', value: 'Contrato Fechado' }
        ],
        period: { start: '', end: '', field: 'DATA_DA_PROSPECCAO' },
        sort: { field: 'FATURAMENTO', order: 'desc' }
      }
    },
    {
      id: 'tpl-motivos-declinio',
      title: 'Motivos de Declínio e Desistência',
      description: 'Levantamento qualitativo das oportunidades não convertidas para auditoria e melhoria comercial.',
      category: 'Auditoria Comercial',
      icon: '⚠️',
      config: {
        source: 'proposals',
        columns: ['Motivo_Declinio', 'TEMPERATURA_CONTRATO', 'VIDAS', 'FATURAMENTO'],
        groupBy: 'Motivo_Declinio',
        measures: ['count', 'sum_VIDAS', 'sum_FATURAMENTO'],
        filters: [
          { field: 'Motivo_Declinio', operator: 'is_not_empty', value: '' }
        ],
        period: { start: '', end: '', field: 'DATA_DA_PROSPECCAO' },
        sort: { field: 'count', order: 'desc' }
      }
    }
  ];

  // Extração e Enriquecimento de Dados
  function extractSourceRecords(sourceKey, appData, user) {
    if (!appData) return [];

    // Checagem de permissão
    const isMaster = user && (
      (user.profile && user.profile.toLowerCase().includes('master')) ||
      (user.login && user.login.toUpperCase() === 'RAMON')
    );

    if (sourceKey === 'audit' && !isMaster) {
      return []; // Restrito ao Administrador Master
    }

    switch (sourceKey) {
      case 'proposals': {
        const raw = appData.proposals || [];
        // Se usuário for consultor restrito e houver regra, filtra. Caso contrário, retorna base acessível.
        return raw.map(p => ({
          ...p,
          _vidas_num: parseNumber(p.VIDAS),
          _fat_num: parseCurrency(p.FATURAMENTO),
          _tkm_num: parseCurrency(p.TKM)
        }));
      }

      case 'companies': {
        const raw = appData.companies || [];
        const proposals = appData.proposals || [];

        // Agrupa propostas por empresa para métricas consolidadas
        const map = {};
        for (const p of proposals) {
          const emp = (p.EMPRESA || '').trim();
          if (!emp) continue;
          if (!map[emp]) {
            map[emp] = {
              count: 0,
              vidas: 0,
              faturamento: 0,
              cnpj: p.CNPJ || '',
              uf: p.UF || '',
              campanha: p.PLANO_CAMPANHA || '',
              brokers: new Set(),
              lastDate: p.DATA_DA_PROSPECCAO || ''
            };
          }
          map[emp].count++;
          map[emp].vidas += parseNumber(p.VIDAS);
          map[emp].faturamento += parseCurrency(p.FATURAMENTO);
          if (p.CNPJ && !map[emp].cnpj) map[emp].cnpj = p.CNPJ;
          if (p.UF && !map[emp].uf) map[emp].uf = p.UF;
          if (p.PLANO_CAMPANHA) map[emp].campanha = p.PLANO_CAMPANHA;
          if (p.CORRETORES_1) map[emp].brokers.add(p.CORRETORES_1);
          if (p.DATA_DA_PROSPECCAO) map[emp].lastDate = p.DATA_DA_PROSPECCAO;
        }

        return raw.map(c => {
          const name = c.EMPRESA || '';
          const stats = map[name] || {
            count: 0,
            vidas: 0,
            faturamento: 0,
            cnpj: '',
            uf: 'BA',
            campanha: '—',
            brokers: new Set(),
            lastDate: '—'
          };
          return {
            EMPRESA: name,
            CNPJ: stats.cnpj || '—',
            UF: stats.uf || 'BA',
            PLANO_CAMPANHA: stats.campanha || '—',
            CORRETORES: Array.from(stats.brokers).join(', ') || '—',
            QNT_PROPOSTAS: stats.count,
            TOTAL_VIDAS: stats.vidas,
            TOTAL_FATURAMENTO: formatCurrency(stats.faturamento),
            ULTIMA_PROSPECCAO: stats.lastDate || '—',
            _vidas_num: stats.vidas,
            _fat_num: stats.faturamento,
            _propostas_num: stats.count
          };
        });
      }

      case 'brokers': {
        const raw = appData.brokers || [];
        const proposals = appData.proposals || [];

        const brokerMap = {};
        for (const p of proposals) {
          const b = (p.CORRETORES_1 || '').trim();
          if (!b) continue;
          if (!brokerMap[b]) {
            brokerMap[b] = { count: 0, closed: 0, vidas: 0, faturamento: 0 };
          }
          brokerMap[b].count++;
          if (p.TEMPERATURA_CONTRATO === 'Contrato Fechado') {
            brokerMap[b].closed++;
          }
          brokerMap[b].vidas += parseNumber(p.VIDAS);
          brokerMap[b].faturamento += parseCurrency(p.FATURAMENTO);
        }

        return raw.map(b => {
          const name = (b.CORRETOR_1 || b['Corretor 1'] || b.corretor_1 || '').trim();
          const stats = brokerMap[name] || { count: 0, closed: 0, vidas: 0, faturamento: 0 };
          const convRate = stats.count > 0 ? ((stats.closed / stats.count) * 100).toFixed(1) : '0.0';
          const tkmMedio = stats.vidas > 0 ? stats.faturamento / stats.vidas : 0;
          return {
            NOME_CORRETOR: name,
            TOTAL_PROPOSTAS: stats.count,
            CONTRATOS_FECHADOS: stats.closed,
            TAXA_CONVERSAO: Number(convRate),
            TOTAL_VIDAS: stats.vidas,
            TOTAL_FATURAMENTO: formatCurrency(stats.faturamento),
            TKM_MEDIO: formatCurrency(tkmMedio),
            _vidas_num: stats.vidas,
            _fat_num: stats.faturamento,
            _propostas_num: stats.count,
            _closed_num: stats.closed
          };
        });
      }

      case 'campaigns': {
        const list = appData.campaignsList || [];
        const proposals = appData.proposals || [];

        const campMap = {};
        for (const p of proposals) {
          const c = (p.PLANO_CAMPANHA || '').trim();
          if (!c) continue;
          if (!campMap[c]) {
            campMap[c] = { count: 0, vidas: 0, faturamento: 0 };
          }
          campMap[c].count++;
          campMap[c].vidas += parseNumber(p.VIDAS);
          campMap[c].faturamento += parseCurrency(p.FATURAMENTO);
        }

        return list.map(c => {
          const name = c.name || '';
          const stats = campMap[name] || { count: 0, vidas: 0, faturamento: 0 };
          const tkm = stats.vidas > 0 ? stats.faturamento / stats.vidas : 0;
          const comps = Array.isArray(c.competencias) ? c.competencias.join(', ') : (c.competencias || '—');
          const statuses = Array.isArray(c.statuses) ? c.statuses.join(', ') : (c.statuses || 'Campanha Encerrada');
          return {
            NOME_CAMPANHA: name,
            STATUS: statuses.includes('Ativa') ? 'Ativa' : 'Encerrada',
            COMPETENCIAS: comps,
            TOTAL_PROPOSTAS: stats.count,
            TOTAL_VIDAS: stats.vidas,
            TOTAL_FATURAMENTO: formatCurrency(stats.faturamento),
            TICKET_MEDIO: formatCurrency(tkm),
            _vidas_num: stats.vidas,
            _fat_num: stats.faturamento,
            _propostas_num: stats.count
          };
        });
      }

      case 'policies': {
        const copart = appData.coparticipationPolicies || [];
        const agency = appData.agencyPolicies || [];
        const records = [];

        for (const cp of copart) {
          records.push({
            TIPO_POLITICA: 'Coparticipação',
            NOME_POLITICA: cp.Nome_Politica || 'Coparticipação Padrão',
            DESCONTO_EVENTO: cp.Percentual_Desconto_Evento ? (String(cp.Percentual_Desconto_Evento).includes('%') ? cp.Percentual_Desconto_Evento : `${cp.Percentual_Desconto_Evento}%`) : '—',
            CONSULTA_ELETIVA: cp.Valor_Consulta_Eletiva ? formatCurrency(cp.Valor_Consulta_Eletiva) : '—',
            CONSULTA_EMERGENCIA: cp.Valor_Consulta_Emergencia ? formatCurrency(cp.Valor_Consulta_Emergencia) : '—',
            EXAMES_SIMPLES: cp.Valor_Exames_Simples ? formatCurrency(cp.Valor_Exames_Simples) : '—',
            EXAMES_COMPLEXOS: cp.Valor_Exames_Complexos ? formatCurrency(cp.Valor_Exames_Complexos) : '—',
            TERAPIA: cp.Valor_Terapia ? formatCurrency(cp.Valor_Terapia) : '—'
          });
        }

        for (const ag of agency) {
          records.push({
            TIPO_POLITICA: 'Agenciamento e Vitalício',
            NOME_POLITICA: ag.Nome_Politica || 'Regra Padrão de Comissionamento',
            DESCONTO_EVENTO: 'Conforme Tabela de Escalonamento',
            CONSULTA_ELETIVA: '—',
            CONSULTA_EMERGENCIA: '—',
            EXAMES_SIMPLES: '—',
            EXAMES_COMPLEXOS: '—',
            TERAPIA: '—'
          });
        }

        return records;
      }

      case 'audit': {
        if (!isMaster) return [];
        const logs = appData.auditLogs || [];
        const reqs = appData.requirementsList || [];
        const records = [];

        // Logs de auditoria do sistema
        for (const l of logs) {
          records.push({
            TIPO_REGISTRO: 'Log de Auditoria',
            IDENTIFICADOR: l.id || 'LOG',
            TITULO_ACAO: l.action || 'Ação do Sistema',
            USUARIO_MODULO: l.user || 'SISTEMA',
            DATA_HORA: l.timestamp || '—',
            STATUS_SEVERIDADE: l.status === 'success' ? 'Sucesso' : (l.status === 'warning' ? 'Alerta' : 'Informativo'),
            DETALHES: `${l.details || ''} [IP: ${l.ip || '—'}]`
          });
        }

        // Requisitos normativos
        for (const r of reqs) {
          records.push({
            TIPO_REGISTRO: 'Requisito Funcional',
            IDENTIFICADOR: r.codigo || r.id || 'RN',
            TITULO_ACAO: r.nome || r.titulo || 'Regra de Negócio',
            USUARIO_MODULO: r.modulo || 'Comercial',
            DATA_HORA: 'Homologado v1.0',
            STATUS_SEVERIDADE: r.status || 'Ativo',
            DETALHES: r.descricao || 'Regra de validação cadastrada'
          });
        }

        return records;
      }

      default:
        return [];
    }
  }

  // Avaliação de Filtros Combinados
  function evaluateCondition(recordValue, operator, targetValue, fieldType) {
    const isValEmpty = recordValue === null || recordValue === undefined || String(recordValue).trim() === '' || recordValue === '—';

    if (operator === 'is_empty') return isValEmpty;
    if (operator === 'is_not_empty') return !isValEmpty;

    if (isValEmpty && operator !== 'neq') return false;

    // Comparação numérica/moeda
    if (fieldType === 'number' || fieldType === 'currency') {
      const numRec = parseNumber(recordValue);
      const numTarget = parseNumber(targetValue);

      if (operator === 'eq') return Math.abs(numRec - numTarget) < 0.001;
      if (operator === 'neq') return Math.abs(numRec - numTarget) >= 0.001;
      if (operator === 'gt') return numRec > numTarget;
      if (operator === 'gte') return numRec >= numTarget;
      if (operator === 'lt') return numRec < numTarget;
      if (operator === 'lte') return numRec <= numTarget;
      if (operator === 'between') {
        const parts = String(targetValue).split(';');
        const min = parseNumber(parts[0]);
        const max = parseNumber(parts[1]);
        return numRec >= min && numRec <= max;
      }
    }

    // Comparação de data
    if (fieldType === 'date') {
      const dateRec = parseDateBR(recordValue);
      if (!dateRec) return false;

      if (operator === 'between') {
        const parts = String(targetValue).split(';');
        const dStart = parseDateBR(parts[0]);
        const dEnd = parseDateBR(parts[1]);
        if (dStart && dateRec < dStart) return false;
        if (dEnd && dateRec > dEnd) return false;
        return true;
      }

      const dateTarget = parseDateBR(targetValue);
      if (!dateTarget) return false;
      const tRec = dateRec.setHours(0, 0, 0, 0);
      const tTgt = dateTarget.setHours(0, 0, 0, 0);

      if (operator === 'eq') return tRec === tTgt;
      if (operator === 'neq') return tRec !== tTgt;
      if (operator === 'gt') return tRec > tTgt;
      if (operator === 'gte') return tRec >= tTgt;
      if (operator === 'lt') return tRec < tTgt;
      if (operator === 'lte') return tRec <= tTgt;
    }

    // Comparação textual padrão (case-insensitive)
    const strRec = String(recordValue || '').toLowerCase().trim();
    const strTarget = String(targetValue || '').toLowerCase().trim();

    if (operator === 'eq') return strRec === strTarget;
    if (operator === 'neq') return strRec !== strTarget;
    if (operator === 'contains') return strRec.includes(strTarget);
    if (operator === 'not_contains') return !strRec.includes(strTarget);
    if (operator === 'starts_with') return strRec.startsWith(strTarget);

    return true;
  }

  function filterRecords(records, filters = [], period = {}, schema) {
    if (!Array.isArray(records)) return [];

    const columnMap = {};
    if (schema && Array.isArray(schema.columns)) {
      schema.columns.forEach(col => { columnMap[col.id] = col; });
    }

    return records.filter(rec => {
      // 1. Filtro rápido de período
      if (period && (period.start || period.end)) {
        const pField = period.field || (schema ? schema.dateField : null);
        if (pField && rec[pField]) {
          const recDate = parseDateBR(rec[pField]);
          if (recDate) {
            if (period.start) {
              const dStart = parseDateBR(period.start);
              if (dStart && recDate < dStart) return false;
            }
            if (period.end) {
              const dEnd = parseDateBR(period.end);
              if (dEnd && recDate > dEnd) return false;
            }
          }
        }
      }

      // 2. Filtros combinados
      if (Array.isArray(filters) && filters.length > 0) {
        for (const f of filters) {
          if (!f || !f.field || !f.operator) continue;
          const colDef = columnMap[f.field] || { type: 'text' };
          const recVal = rec[f.field];
          const matched = evaluateCondition(recVal, f.operator, f.value, colDef.type);
          if (!matched) return false;
        }
      }

      return true;
    });
  }

  // Motor de Agrupamento e Agregação
  function aggregateRecords(records, groupByField, measures = [], schema) {
    if (!groupByField) return records;

    const columnMap = {};
    if (schema && Array.isArray(schema.columns)) {
      schema.columns.forEach(col => { columnMap[col.id] = col; });
    }

    const groups = new Map();

    for (const rec of records) {
      let keyVal = rec[groupByField];
      if (keyVal === null || keyVal === undefined || String(keyVal).trim() === '') {
        keyVal = '(Não informado)';
      }

      if (!groups.has(keyVal)) {
        groups.set(keyVal, {
          [groupByField]: keyVal,
          _recordsCount: 0,
          _sums: {},
          _records: []
        });
      }

      const grp = groups.get(keyVal);
      grp._recordsCount++;
      grp._records.push(rec);

      // Acumula somas para possíveis medidas
      for (const colId of Object.keys(rec)) {
        const colDef = columnMap[colId];
        if (colDef && (colDef.type === 'number' || colDef.type === 'currency')) {
          const val = parseNumber(rec[colId]);
          grp._sums[colId] = (grp._sums[colId] || 0) + val;
        }
      }
    }

    const aggregated = [];

    for (const [key, grp] of groups.entries()) {
      const row = {
        [groupByField]: key,
        count: grp._recordsCount
      };

      // Calcula medidas solicitadas
      for (const m of measures) {
        if (m === 'count') {
          row['count'] = grp._recordsCount;
        } else if (m.startsWith('sum_')) {
          const field = m.replace('sum_', '');
          const sumVal = grp._sums[field] || 0;
          const colDef = columnMap[field];
          row[m] = colDef && colDef.type === 'currency' ? formatCurrency(sumVal) : sumVal;
          row[`_${m}_raw`] = sumVal;
        } else if (m.startsWith('avg_')) {
          const field = m.replace('avg_', '');
          const sumVal = grp._sums[field] || 0;
          const avgVal = grp._recordsCount > 0 ? sumVal / grp._recordsCount : 0;
          const colDef = columnMap[field];
          row[m] = colDef && colDef.type === 'currency' ? formatCurrency(avgVal) : Number(avgVal.toFixed(2));
          row[`_${m}_raw`] = avgVal;
        }
      }

      aggregated.push(row);
    }

    return aggregated;
  }

  // Motor de Ordenação Universal
  function sortRecords(records, sortField, sortOrder = 'asc', schema) {
    if (!sortField || !Array.isArray(records)) return records;

    const columnMap = {};
    if (schema && Array.isArray(schema.columns)) {
      schema.columns.forEach(col => { columnMap[col.id] = col; });
    }

    const colDef = columnMap[sortField] || { type: 'text' };
    const direction = sortOrder.toLowerCase() === 'desc' ? -1 : 1;

    return [...records].sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];

      // Valores nulos/indefinidos vão para o final
      if ((valA === null || valA === undefined || valA === '—') && (valB === null || valB === undefined || valB === '—')) return 0;
      if (valA === null || valA === undefined || valA === '—') return 1;
      if (valB === null || valB === undefined || valB === '—') return -1;

      // Ordenação numérica / moeda
      if (colDef.type === 'number' || colDef.type === 'currency' || sortField === 'count' || sortField.startsWith('sum_') || sortField.startsWith('avg_')) {
        const numA = typeof valA === 'number' ? valA : parseNumber(valA);
        const numB = typeof valB === 'number' ? valB : parseNumber(valB);
        return (numA - numB) * direction;
      }

      // Ordenação por data
      if (colDef.type === 'date') {
        const dateA = parseDateBR(valA);
        const dateB = parseDateBR(valB);
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return (dateA.getTime() - dateB.getTime()) * direction;
      }

      // Ordenação textual
      const strA = String(valA);
      const strB = String(valB);
      return strA.localeCompare(strB, 'pt-BR', { numeric: true, sensitivity: 'base' }) * direction;
    });
  }

  // Cálculo de Totais Gerais (Rodapé da Tabela)
  function calculateGrandTotals(records, displayedColumns = [], schema, isGrouped = false) {
    if (!Array.isArray(records) || records.length === 0) return null;

    const columnMap = {};
    if (schema && Array.isArray(schema.columns)) {
      schema.columns.forEach(col => { columnMap[col.id] = col; });
    }

    const totals = {
      _isTotalsRow: true,
      _totalCount: records.length
    };

    let totalVidas = 0;
    let totalFat = 0;
    let hasVidas = false;
    let hasFat = false;

    for (const colId of displayedColumns) {
      if (colId === 'count') {
        const sumCount = records.reduce((acc, r) => acc + (parseNumber(r.count) || 0), 0);
        totals[colId] = sumCount;
        continue;
      }

      if (colId.startsWith('sum_')) {
        const rawKey = `_${colId}_raw`;
        const sumVal = records.reduce((acc, r) => acc + (r[rawKey] !== undefined ? r[rawKey] : parseNumber(r[colId])), 0);
        const originalField = colId.replace('sum_', '');
        const colDef = columnMap[originalField];
        totals[colId] = colDef && colDef.type === 'currency' ? formatCurrency(sumVal) : sumVal;
        if (originalField === 'VIDAS' || originalField === 'TOTAL_VIDAS') {
          totalVidas = sumVal;
          hasVidas = true;
        }
        if (originalField === 'FATURAMENTO' || originalField === 'TOTAL_FATURAMENTO') {
          totalFat = sumVal;
          hasFat = true;
        }
        continue;
      }

      if (colId.startsWith('avg_')) {
        const rawKey = `_${colId}_raw`;
        const sumVal = records.reduce((acc, r) => acc + (r[rawKey] !== undefined ? r[rawKey] : parseNumber(r[colId])), 0);
        const avgVal = records.length > 0 ? sumVal / records.length : 0;
        const originalField = colId.replace('avg_', '');
        const colDef = columnMap[originalField];
        totals[colId] = colDef && colDef.type === 'currency' ? formatCurrency(avgVal) : Number(avgVal.toFixed(2));
        continue;
      }

      const colDef = columnMap[colId];
      if (colDef && colDef.type === 'number') {
        const sum = records.reduce((acc, r) => acc + parseNumber(r[colId]), 0);
        totals[colId] = sum;
        if (colId === 'VIDAS' || colId === 'TOTAL_VIDAS') {
          totalVidas = sum;
          hasVidas = true;
        }
      } else if (colDef && colDef.type === 'currency') {
        const sum = records.reduce((acc, r) => acc + parseCurrency(r[colId]), 0);
        totals[colId] = formatCurrency(sum);
        if (colId === 'FATURAMENTO' || colId === 'TOTAL_FATURAMENTO') {
          totalFat = sum;
          hasFat = true;
        }
      } else {
        totals[colId] = '—';
      }
    }

    // Marca a primeira coluna exibida com rótulo "TOTAIS GERAIS"
    if (displayedColumns.length > 0) {
      totals[displayedColumns[0]] = `TOTAL (${records.length} ${records.length === 1 ? 'item' : 'itens'})`;
    }

    totals._summary = {
      recordsCount: records.length,
      totalVidas: hasVidas ? totalVidas : null,
      totalFaturamento: hasFat ? totalFat : null
    };

    return totals;
  }

  // Execução do Relatório Completo
  function executeReport(config, appData, user) {
    const sourceKey = config.source || 'proposals';
    const schema = DATA_SOURCES[sourceKey] || DATA_SOURCES.proposals;

    // Checagem de permissão
    const isMaster = user && (
      (user.profile && user.profile.toLowerCase().includes('master')) ||
      (user.login && user.login.toUpperCase() === 'RAMON')
    );

    if (schema.requiresMaster && !isMaster) {
      return {
        error: 'Acesso negado: Você não possui permissão para emitir relatórios desta fonte de dados.',
        records: [],
        totals: null,
        schema,
        config
      };
    }

    // 1. Extrai dados brutos da fonte
    const rawRecords = extractSourceRecords(sourceKey, appData, user);

    // 2. Aplica filtros e período
    const filteredRecords = filterRecords(rawRecords, config.filters, config.period, schema);

    // 3. Aplica agrupamento se configurado
    let finalRecords = [];
    let displayedColumns = [];

    if (config.groupBy) {
      const measures = Array.isArray(config.measures) && config.measures.length > 0
        ? config.measures
        : ['count'];
      finalRecords = aggregateRecords(filteredRecords, config.groupBy, measures, schema);

      // Colunas no modo agrupado
      displayedColumns = [config.groupBy, ...measures];
    } else {
      finalRecords = filteredRecords;
      displayedColumns = Array.isArray(config.columns) && config.columns.length > 0
        ? config.columns
        : schema.columns.filter(c => c.defaultSelected).map(c => c.id);
    }

    // 4. Aplica ordenação
    const sortField = config.sort && config.sort.field ? config.sort.field : (displayedColumns[0] || 'ID');
    const sortOrder = config.sort && config.sort.order ? config.sort.order : 'asc';
    finalRecords = sortRecords(finalRecords, sortField, sortOrder, schema);

    // 5. Calcula linha de totais
    const grandTotals = calculateGrandTotals(finalRecords, displayedColumns, schema, !!config.groupBy);

    return {
      sourceKey,
      schema,
      config,
      displayedColumns,
      records: finalRecords,
      totalCount: finalRecords.length,
      rawCount: rawRecords.length,
      filteredCount: filteredRecords.length,
      grandTotals,
      generatedAt: new Date()
    };
  }

  // Gerenciamento de Relatórios Salvos no Armazenamento Local
  function getSavedReports() {
    try {
      if (typeof localStorage === 'undefined') return [];
      const data = localStorage.getItem(STORAGE_SAVED_REPORTS_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('Erro ao carregar relatórios salvos:', e);
      return [];
    }
  }

  function saveReport(report) {
    if (!report || !report.title) return { success: false, error: 'O relatório deve possuir um título.' };
    const list = getSavedReports();
    const id = report.id || `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const item = {
      ...report,
      id,
      updatedAt: new Date().toISOString()
    };

    const existingIndex = list.findIndex(r => r.id === id);
    if (existingIndex >= 0) {
      list[existingIndex] = item;
    } else {
      list.unshift(item);
    }

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_SAVED_REPORTS_KEY, JSON.stringify(list));
      }
      return { success: true, report: item };
    } catch (e) {
      return { success: false, error: 'Erro ao salvar relatório no navegador: ' + e.message };
    }
  }

  function deleteReport(reportId) {
    const list = getSavedReports();
    const filtered = list.filter(r => r.id !== reportId);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_SAVED_REPORTS_KEY, JSON.stringify(filtered));
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function duplicateReport(reportId) {
    const list = getSavedReports();
    const found = list.find(r => r.id === reportId);
    if (!found) return { success: false, error: 'Relatório não encontrado.' };

    const clone = {
      ...JSON.parse(JSON.stringify(found)),
      id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: `${found.title} (Cópia)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return saveReport(clone);
  }

  // Exportação CSV com Metadados, Padrão pt-BR e UTF-8 com BOM
  function exportToCSV(reportResult, options = {}) {
    if (!reportResult || !Array.isArray(reportResult.records)) {
      throw new Error('Nenhum resultado válido para exportação.');
    }

    const { schema, displayedColumns, records, grandTotals, config } = reportResult;
    const reportTitle = options.title || config.title || schema.label || 'Relatório CRM SB Saúde';
    const userName = options.userName || 'Usuário do Sistema';
    const now = new Date();
    const timestampStr = `${formatDateBR(now)} às ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const columnMap = {};
    if (schema && Array.isArray(schema.columns)) {
      schema.columns.forEach(c => { columnMap[c.id] = c; });
    }

    // Construtor do CSV
    const lines = [];

    // Metadados do Relatório no Cabeçalho
    lines.push(`"CRM SB SAÚDE — RELATÓRIO CORPORATIVO"`);
    lines.push(`"Título:";"${reportTitle.replace(/"/g, '""')}"`);
    lines.push(`"Fonte de Dados:";"${(schema.label || '').replace(/"/g, '""')}"`);
    lines.push(`"Data e Hora da Emissão:";"${timestampStr}"`);
    lines.push(`"Emitido por:";"${userName.replace(/"/g, '""')}"`);
    lines.push(`"Total de Registros:";"${records.length}"`);

    // Filtros aplicados
    if (config.period && (config.period.start || config.period.end)) {
      const pStr = `De ${config.period.start || 'Início'} até ${config.period.end || 'Atual'}`;
      lines.push(`"Período Filtrado:";"${pStr}"`);
    }
    if (Array.isArray(config.filters) && config.filters.length > 0) {
      const fStrs = config.filters.map(f => {
        const col = columnMap[f.field];
        return `${col ? col.label : f.field} ${f.operator} "${f.value}"`;
      });
      lines.push(`"Filtros Aplicados:";"${fStrs.join(' | ').replace(/"/g, '""')}"`);
    }
    if (config.groupBy) {
      const grpCol = columnMap[config.groupBy];
      lines.push(`"Agrupado por:";"${(grpCol ? grpCol.label : config.groupBy).replace(/"/g, '""')}"`);
    }

    lines.push(''); // Linha em branco separadora

    // Cabeçalho das Colunas
    const headers = displayedColumns.map(colId => {
      if (colId === 'count') return '"Qtd Registros"';
      if (colId.startsWith('sum_')) {
        const orig = colId.replace('sum_', '');
        const col = columnMap[orig];
        return `"${('Soma de ' + (col ? col.label : orig)).replace(/"/g, '""')}"`;
      }
      if (colId.startsWith('avg_')) {
        const orig = colId.replace('avg_', '');
        const col = columnMap[orig];
        return `"${('Média de ' + (col ? col.label : orig)).replace(/"/g, '""')}"`;
      }
      const col = columnMap[colId];
      return `"${(col ? col.label : colId).replace(/"/g, '""')}"`;
    });
    lines.push(headers.join(';'));

    // Linhas de Dados
    for (const rec of records) {
      const row = displayedColumns.map(colId => {
        const val = rec[colId];
        if (val === null || val === undefined || val === '') return '""';
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      lines.push(row.join(';'));
    }

    // Linha de Totais
    if (grandTotals) {
      lines.push('');
      const totalRow = displayedColumns.map(colId => {
        const val = grandTotals[colId];
        if (val === null || val === undefined || val === '') return '""';
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      lines.push(totalRow.join(';'));
    }

    // Adiciona BOM UTF-8 (\uFEFF) para garantir acentuação correta no Microsoft Excel
    return '\uFEFF' + lines.join('\r\n');
  }

  // Gera HTML formatado para Impressão / Exportação PDF
  function buildPrintDocument(reportResult, options = {}) {
    const { schema, displayedColumns, records, grandTotals, config } = reportResult;
    const reportTitle = options.title || config.title || schema.label || 'Relatório Gerencial';
    const userName = options.userName || 'Usuário Autenticado';
    const now = new Date();
    const timestampStr = `${formatDateBR(now)} às ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const columnMap = {};
    if (schema && Array.isArray(schema.columns)) {
      schema.columns.forEach(c => { columnMap[c.id] = c; });
    }

    let filterBadges = '';
    if (config.period && (config.period.start || config.period.end)) {
      filterBadges += `<span class="badge">Período: ${config.period.start || 'Início'} a ${config.period.end || 'Atual'}</span>`;
    }
    if (Array.isArray(config.filters) && config.filters.length > 0) {
      config.filters.forEach(f => {
        const col = columnMap[f.field];
        filterBadges += `<span class="badge">${col ? col.label : f.field} ${f.operator} ${f.value || ''}</span>`;
      });
    }
    if (config.groupBy) {
      const col = columnMap[config.groupBy];
      filterBadges += `<span class="badge badge-group">Agrupado: ${col ? col.label : config.groupBy}</span>`;
    }
    if (!filterBadges) filterBadges = '<span class="badge">Todos os registros da fonte</span>';

    const ths = displayedColumns.map(colId => {
      let label = colId;
      if (colId === 'count') label = 'Qtd Registros';
      else if (colId.startsWith('sum_')) {
        const orig = colId.replace('sum_', '');
        label = `Soma (${columnMap[orig] ? columnMap[orig].label : orig})`;
      } else if (colId.startsWith('avg_')) {
        const orig = colId.replace('avg_', '');
        label = `Média (${columnMap[orig] ? columnMap[orig].label : orig})`;
      } else if (columnMap[colId]) {
        label = columnMap[colId].label;
      }
      return `<th>${label}</th>`;
    }).join('');

    const trs = records.map((rec, idx) => {
      const tds = displayedColumns.map(colId => {
        const val = rec[colId];
        const display = (val === null || val === undefined || val === '') ? '—' : val;
        return `<td>${display}</td>`;
      }).join('');
      return `<tr>${tds}</tr>`;
    }).join('');

    let totalsTr = '';
    if (grandTotals) {
      const totalsTds = displayedColumns.map(colId => {
        const val = grandTotals[colId];
        const display = (val === null || val === undefined || val === '') ? '—' : val;
        return `<td><strong>${display}</strong></td>`;
      }).join('');
      totalsTr = `<tr class="totals-row">${totalsTds}</tr>`;
    }

    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${reportTitle} — CRM SB Saúde</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; color: #1e293b; background: #fff; margin: 0; padding: 20px; font-size: 11px; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #be123c; padding-bottom: 12px; margin-bottom: 16px; }
    .logo-box { display: flex; align-items: center; gap: 10px; }
    .logo-badge { background: #be123c; color: #fff; padding: 6px 12px; border-radius: 6px; font-weight: 800; font-size: 14px; letter-spacing: 0.5px; }
    .title-box h1 { margin: 0; font-size: 18px; color: #0f172a; font-weight: 700; }
    .title-box p { margin: 2px 0 0; color: #64748b; font-size: 11px; }
    .meta-box { text-align: right; font-size: 10px; color: #64748b; }
    .filters-bar { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .filters-label { font-weight: 600; color: #475569; font-size: 10px; text-transform: uppercase; }
    .badge { background: #e2e8f0; color: #334155; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 500; }
    .badge-group { background: #fee2e2; color: #991b1b; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 10px; }
    th { background: #f1f5f9; color: #334155; text-align: left; padding: 7px 9px; font-weight: 600; border-bottom: 2px solid #cbd5e1; white-space: nowrap; }
    td { padding: 6px 9px; border-bottom: 1px solid #e2e8f0; color: #334155; }
    tr:nth-child(even) td { background-color: #f8fafc; }
    .totals-row td { background: #f1f5f9 !important; border-top: 2px solid #94a3b8; border-bottom: 2px solid #94a3b8; font-weight: bold; color: #0f172a; }
    .footer { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-box">
      <div class="logo-badge">SB SAÚDE</div>
      <div class="title-box">
        <h1>${reportTitle}</h1>
        <p>Fonte: ${schema.label} • CRM Comercial SB Saúde Operadora</p>
      </div>
    </div>
    <div class="meta-box">
      <div><strong>Emissão:</strong> ${timestampStr}</div>
      <div><strong>Operador:</strong> ${userName}</div>
      <div><strong>Total:</strong> ${records.length} registros</div>
    </div>
  </div>

  <div class="filters-bar">
    <span class="filters-label">Parâmetros e Filtros:</span>
    ${filterBadges}
  </div>

  <table>
    <thead>
      <tr>${ths}</tr>
    </thead>
    <tbody>
      ${trs}
      ${totalsTr}
    </tbody>
  </table>

  <div class="footer">
    <div>SB Saúde Operadora de Planos de Saúde • Documento confidencial para uso interno exclusivo.</div>
    <div>Página 1 de 1 • Sistema CRM Integrado v2.4</div>
  </div>

  <script>
    window.onload = function() {
      window.print();
    };
  </script>
</body>
</html>
    `;
  }

  // API Pública do Motor
  return {
    DATA_SOURCES,
    SUGGESTED_TEMPLATES,
    parseNumber,
    parseCurrency,
    formatCurrency,
    formatNumber,
    parseDateBR,
    formatDateBR,
    extractSourceRecords,
    filterRecords,
    aggregateRecords,
    sortRecords,
    calculateGrandTotals,
    executeReport,
    getSavedReports,
    saveReport,
    deleteReport,
    duplicateReport,
    exportToCSV,
    buildPrintDocument
  };
});
