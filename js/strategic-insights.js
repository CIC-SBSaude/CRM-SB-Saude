/**
 * CRM SB Saúde — Módulo de Insights Estratégicos Factuais
 * Métricas comerciais auditáveis calculadas exclusivamente sobre dados reais.
 * Suporta filtragem por escopo (período, base de data, corretor, status, UF, empresa).
 */

(function () {
  'use strict';

  // Utilitário para parsing de datas no formato DD/MM/YYYY ou ISO
  function parseBrDate(str) {
    if (!str) return null;
    if (str instanceof Date) return isNaN(str.getTime()) ? null : str;
    const s = String(str).trim();
    if (!s) return null;

    // Formato DD/MM/YYYY ou DD/MM/YYYY HH:mm:ss
    const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10) - 1;
      const year = parseInt(dmyMatch[3], 10);
      const dt = new Date(year, month, day);
      return isNaN(dt.getTime()) ? null : dt;
    }

    // Formato YYYY-MM-DD
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10) - 1;
      const day = parseInt(isoMatch[3], 10);
      const dt = new Date(year, month, day);
      return isNaN(dt.getTime()) ? null : dt;
    }

    const fallback = new Date(s);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  // Extração de corretores válidos vinculados à proposta nas 3 posições (sem duplicatas na mesma proposta)
  function extractBrokersFromProposal(p) {
    if (!p) return [];
    const brokers = new Set();
    const rawList = [p.CORRETORES_1, p.CORRETORES_2, p.CORRETORES_3];

    rawList.forEach(raw => {
      if (raw && typeof raw === 'string') {
        const clean = raw.trim();
        // Ignora marcadores genéricos ou nulos
        if (clean && clean !== '-' && clean !== '--' && clean.toLowerCase() !== 'direto' && clean.toLowerCase() !== 'sem corretor') {
          brokers.add(clean);
        }
      }
    });

    return Array.from(brokers);
  }

  // Extração de UFs válidas (suporta propostas interestaduais com múltiplas UFs separadas por vírgula/barra)
  function extractUfsFromProposal(p) {
    if (!p || !p.UF) return [];
    const raw = String(p.UF).trim();
    if (!raw || raw === '-' || raw === '--') return [];

    const tokens = raw.split(/[,;/+]+/).map(s => s.trim().toUpperCase()).filter(s => s.length === 2);
    return Array.from(new Set(tokens));
  }

  // Filtragem determinística de propostas pelo escopo selecionado
  function filterProposalsByScope(proposals, scope = {}) {
    if (!Array.isArray(proposals)) return [];

    const period = scope.period || 'all'; // 'all' | 'current_month' | 'last_90_days' | 'custom'
    const dateField = scope.dateField === 'competencia' ? 'COMPETENCIA' : 'DATA_DA_PROSPECCAO';
    const statusFilter = (scope.statusFilter || '').trim();
    const brokerFilter = (scope.brokerFilter || '').trim();
    const ufFilter = (scope.ufFilter || '').trim().toUpperCase();
    const companyFilter = (scope.companyFilter || '').trim().toLowerCase();

    const now = scope.referenceDate ? new Date(scope.referenceDate) : new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    let customStart = null;
    let customEnd = null;
    if (period === 'custom') {
      customStart = parseBrDate(scope.dateFrom);
      customEnd = parseBrDate(scope.dateTo);
      if (customEnd) customEnd.setHours(23, 59, 59, 999);
    } else if (period === 'last_90_days') {
      customStart = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
      customEnd = now;
    }

    return proposals.filter(p => {
      // 1. Filtro Temporal
      if (period !== 'all') {
        const rawDate = p[dateField] || p.DATA_DA_PROSPECCAO || p.COMPETENCIA;
        const pDate = parseBrDate(rawDate);
        if (!pDate) return false;

        if (period === 'current_month') {
          if (pDate.getFullYear() !== currentYear || pDate.getMonth() !== currentMonth) {
            return false;
          }
        } else if (period === 'last_90_days' || period === 'custom') {
          if (customStart && pDate < customStart) return false;
          if (customEnd && pDate > customEnd) return false;
        }
      }

      // 2. Filtro por Status / Temperatura
      if (statusFilter && statusFilter !== 'all' && statusFilter !== 'Todos') {
        const temp = (p.TEMPERATURA_CONTRATO || '').trim();
        if (temp.toLowerCase() !== statusFilter.toLowerCase()) {
          return false;
        }
      }

      // 3. Filtro por Corretor (busca nas 3 posições)
      if (brokerFilter && brokerFilter !== 'all' && brokerFilter !== 'Todos') {
        const pBrokers = extractBrokersFromProposal(p);
        if (brokerFilter === 'Sem corretor') {
          if (pBrokers.length > 0) return false;
        } else {
          if (!pBrokers.some(b => b.toLowerCase() === brokerFilter.toLowerCase())) {
            return false;
          }
        }
      }

      // 4. Filtro por UF
      if (ufFilter && ufFilter !== 'ALL' && ufFilter !== 'TODOS') {
        const pUfs = extractUfsFromProposal(p);
        if (ufFilter === 'SEM_UF' || ufFilter === 'NÃO INFORMADA') {
          if (pUfs.length > 0) return false;
        } else {
          if (!pUfs.includes(ufFilter)) return false;
        }
      }

      // 5. Filtro por Empresa
      if (companyFilter) {
        const emp = (p.EMPRESA || '').toLowerCase();
        const cnpj = (p.CNPJ || '').replace(/\D/g, '');
        const id = String(p.ID || '').toLowerCase();
        if (!emp.includes(companyFilter) && !cnpj.includes(companyFilter) && !id.includes(companyFilter)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Cálculo dos 4 Cartões Factuais de Insights Estratégicos
   * @param {Array} allProposals - Coleção completa autorizada de propostas
   * @param {Object} scope - Filtros de escopo ativo
   * @returns {Object} Dados agregados estruturados para exibição e drilldown
   */
  function calculateFactualStrategicInsights(allProposals, scope = {}) {
    const BusinessRulesRef = (typeof window !== 'undefined' && window.BusinessRules) 
      ? window.BusinessRules 
      : (typeof require !== 'undefined' ? require('./business-rules.js') : null);

    const parseCurrency = BusinessRulesRef ? BusinessRulesRef.parseCurrency.bind(BusinessRulesRef) : (v => {
      if (typeof v === 'number') return v;
      if (!v) return 0;
      return parseFloat(String(v).replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
    });

    const parseLives = BusinessRulesRef ? BusinessRulesRef.parseLives.bind(BusinessRulesRef) : (v => {
      if (typeof v === 'number') return v;
      if (!v) return 0;
      const c = String(v).trim();
      return c.includes('.') ? parseInt(c.replace(/\./g, ''), 10) || 0 : parseInt(c, 10) || 0;
    });

    const formatCurrency = BusinessRulesRef ? BusinessRulesRef.formatCurrency.bind(BusinessRulesRef) : (v => {
      return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    });

    // 1. Aplica filtros de escopo
    const filteredProposals = filterProposalsByScope(allProposals, scope);
    const totalUniverse = filteredProposals.length;

    // Determina rótulo legível do período
    let periodLabel = 'Todo o histórico';
    if (scope.period === 'current_month') {
      const now = scope.referenceDate ? new Date(scope.referenceDate) : new Date();
      periodLabel = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      periodLabel = periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1);
    } else if (scope.period === 'last_90_days') {
      periodLabel = 'Últimos 90 dias';
    } else if (scope.period === 'custom') {
      periodLabel = `${scope.dateFrom || 'Início'} a ${scope.dateTo || 'Hoje'}`;
    }

    // =========================================================================
    // CARTÃO 1: Corretor com mais propostas no período
    // =========================================================================
    const brokerStatsMap = new Map();
    let unassignedProposals = [];

    filteredProposals.forEach(p => {
      const brokers = extractBrokersFromProposal(p);
      const isClosed = (p.TEMPERATURA_CONTRATO || '').trim() === 'Contrato Fechado';

      if (brokers.length === 0) {
        unassignedProposals.push(p);
      } else {
        brokers.forEach(b => {
          if (!brokerStatsMap.has(b)) {
            brokerStatsMap.set(b, {
              name: b,
              count: 0,
              closedCount: 0,
              proposals: []
            });
          }
          const item = brokerStatsMap.get(b);
          item.count++;
          if (isClosed) item.closedCount++;
          item.proposals.push(p);
        });
      }
    });

    // Se houver propostas sem corretor, adiciona a categoria "Sem corretor" para análise
    if (unassignedProposals.length > 0) {
      const closedUnassigned = unassignedProposals.filter(p => (p.TEMPERATURA_CONTRATO || '').trim() === 'Contrato Fechado').length;
      brokerStatsMap.set('Sem corretor', {
        name: 'Sem corretor',
        count: unassignedProposals.length,
        closedCount: closedUnassigned,
        proposals: unassignedProposals,
        isUnassignedCategory: true
      });
    }

    // Ordenação estrita com desempates
    const sortedBrokers = Array.from(brokerStatsMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.closedCount !== a.closedCount) return b.closedCount - a.closedCount;
      return a.name.localeCompare(b.name, 'pt-BR');
    });

    let topBrokerResult = null;
    if (sortedBrokers.length > 0) {
      const topB = sortedBrokers[0];
      topBrokerResult = {
        name: topB.name,
        count: topB.count,
        closedCount: topB.closedCount,
        isUnassigned: Boolean(topB.isUnassignedCategory),
        proposalIds: topB.proposals.map(p => String(p.ID)),
        proposals: topB.proposals,
        periodLabel
      };
    } else {
      topBrokerResult = {
        name: 'Sem dados suficientes',
        count: 0,
        closedCount: 0,
        isUnassigned: false,
        proposalIds: [],
        proposals: [],
        periodLabel
      };
    }

    // =========================================================================
    // CARTÃO 2: Maior proposta do período
    // =========================================================================
    let biggestProposal = null;

    if (totalUniverse > 0) {
      const sortedByValue = [...filteredProposals].sort((a, b) => {
        const valA = parseCurrency(a.FATURAMENTO);
        const valB = parseCurrency(b.FATURAMENTO);
        if (valB !== valA) return valB - valA;

        // Desempate estável por data mais recente e ID
        const dateA = parseBrDate(a.DATA_DA_PROSPECCAO) || new Date(0);
        const dateB = parseBrDate(b.DATA_DA_PROSPECCAO) || new Date(0);
        if (dateB.getTime() !== dateA.getTime()) return dateB.getTime() - dateA.getTime();

        return String(a.ID).localeCompare(String(b.ID));
      });

      const topP = sortedByValue[0];
      const rev = parseCurrency(topP.FATURAMENTO);
      const lives = parseLives(topP.VIDAS);

      biggestProposal = {
        id: String(topP.ID),
        company: topP.EMPRESA || 'Empresa Não Informada',
        lives: lives,
        livesFormatted: lives.toLocaleString('pt-BR'),
        revenue: rev,
        revenueFormatted: topP.FATURAMENTO || formatCurrency(rev),
        status: topP.TEMPERATURA_CONTRATO || 'Iniciada',
        date: topP.DATA_DA_PROSPECCAO || topP.COMPETENCIA || '-',
        proposal: topP
      };
    } else {
      biggestProposal = {
        id: null,
        company: 'Sem dados suficientes',
        lives: 0,
        livesFormatted: '0 vidas',
        revenue: 0,
        revenueFormatted: 'R$ 0,00',
        status: '-',
        date: '-',
        proposal: null
      };
    }

    // =========================================================================
    // CARTÃO 3: UF com mais propostas no período
    // =========================================================================
    const ufStatsMap = new Map();
    let hasMultiUf = false;

    filteredProposals.forEach(p => {
      const ufs = extractUfsFromProposal(p);
      const lives = parseLives(p.VIDAS);

      if (ufs.length === 0) {
        const key = 'UF não informada';
        if (!ufStatsMap.has(key)) {
          ufStatsMap.set(key, { uf: key, count: 0, lives: 0, proposals: [], isUnknown: true });
        }
        const item = ufStatsMap.get(key);
        item.count++;
        item.lives += lives;
        item.proposals.push(p);
      } else {
        if (ufs.length > 1) hasMultiUf = true;
        ufs.forEach(uf => {
          if (!ufStatsMap.has(uf)) {
            ufStatsMap.set(uf, { uf, count: 0, lives: 0, proposals: [], isUnknown: false });
          }
          const item = ufStatsMap.get(uf);
          item.count++;
          item.lives += lives;
          item.proposals.push(p);
        });
      }
    });

    const sortedUfs = Array.from(ufStatsMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.lives !== a.lives) return b.lives - a.lives;
      return a.uf.localeCompare(b.uf, 'pt-BR');
    });

    let topUfResult = null;
    if (sortedUfs.length > 0) {
      const topU = sortedUfs[0];
      topUfResult = {
        uf: topU.uf,
        label: topU.isUnknown ? 'UF não informada' : `Estado ${topU.uf}`,
        count: topU.count,
        lives: topU.lives,
        livesFormatted: topU.lives.toLocaleString('pt-BR'),
        isUnknown: topU.isUnknown,
        hasMultiUfProposals: hasMultiUf,
        proposalIds: topU.proposals.map(p => String(p.ID)),
        proposals: topU.proposals,
        periodLabel
      };
    } else {
      topUfResult = {
        uf: 'Sem dados suficientes',
        label: 'Sem dados suficientes',
        count: 0,
        lives: 0,
        livesFormatted: '0 vidas',
        isUnknown: false,
        hasMultiUfProposals: false,
        proposalIds: [],
        proposals: [],
        periodLabel
      };
    }

    // =========================================================================
    // CARTÃO 4: Valor cotado em propostas fechadas
    // =========================================================================
    const closedProposals = filteredProposals.filter(p => (p.TEMPERATURA_CONTRATO || '').trim() === 'Contrato Fechado');
    let totalClosedRevenue = 0;
    let totalClosedLives = 0;

    closedProposals.forEach(p => {
      totalClosedRevenue += parseCurrency(p.FATURAMENTO);
      totalClosedLives += parseLives(p.VIDAS);
    });

    totalClosedRevenue = Math.round(totalClosedRevenue * 100) / 100;

    const closedCount = closedProposals.length;
    const closureRate = totalUniverse > 0 ? ((closedCount / totalUniverse) * 100).toFixed(1) : '0.0';

    const closedProposalsResult = {
      totalRevenue: totalClosedRevenue,
      formattedRevenue: formatCurrency(totalClosedRevenue),
      closedCount: closedCount,
      totalUniverse: totalUniverse,
      closureRate: closureRate,
      closedLives: totalClosedLives,
      proposalIds: closedProposals.map(p => String(p.ID)),
      proposals: closedProposals,
      periodLabel
    };

    return {
      scope: {
        period: scope.period || 'all',
        periodLabel,
        dateField: scope.dateField || 'prospeccao',
        dateFieldLabel: scope.dateField === 'competencia' ? 'Competência' : 'Data da Prospecção',
        totalUniverse: allProposals.length,
        filteredUniverse: totalUniverse,
        totalProposalsCount: allProposals.length,
        filteredProposalsCount: totalUniverse,
        filteredProposalsPercent: allProposals.length > 0 ? ((totalUniverse / allProposals.length) * 100).toFixed(1) : '100.0',
        activeFiltersCount: [
          scope.statusFilter && scope.statusFilter !== 'all' ? 1 : 0,
          scope.brokerFilter && scope.brokerFilter !== 'all' ? 1 : 0,
          scope.ufFilter && scope.ufFilter !== 'ALL' ? 1 : 0,
          scope.companyFilter ? 1 : 0
        ].reduce((a, b) => a + b, 0)
      },
      topBroker: topBrokerResult,
      biggestProposal,
      topUf: topUfResult,
      closedProposals: closedProposalsResult
    };
  }

  // Exportação compatível com Navegador e Node.js
  const StrategicInsightsAPI = {
    parseBrDate,
    extractBrokersFromProposal,
    extractUfsFromProposal,
    filterProposalsByScope,
    calculateFactualStrategicInsights
  };

  if (typeof window !== 'undefined') {
    window.StrategicInsights = StrategicInsightsAPI;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = StrategicInsightsAPI;
  }
})();
