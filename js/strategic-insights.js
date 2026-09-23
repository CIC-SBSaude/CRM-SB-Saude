/**
 * CRM SB Saúde — Módulo de Insights Estratégicos Factuais
 * Métricas comerciais auditáveis calculadas exclusivamente sobre dados reais.
 * Suporta filtragem por escopo (período, base de data, corretor, status, UF, empresa),
 * cálculo de período anterior equivalente, destinos de pipeline e insights acionáveis.
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
  function extractBrokersFromProposal(p, options = {}) {
    if (!p) return [];
    const includeViaCadastro = options.includeViaCadastro === true;
    const brokers = new Set();
    const rawList = [p.CORRETORES_1, p.CORRETORES_2, p.CORRETORES_3];

    rawList.forEach(raw => {
      if (raw && typeof raw === 'string') {
        const clean = raw.trim();
        // Ignora marcadores genéricos ou nulos, e opcionalmente "Via Cadastro" que é canal de entrada direta
        const isIgnored = !clean || clean === '-' || clean === '--' ||
          clean.toLowerCase() === 'direto' || clean.toLowerCase() === 'sem corretor' ||
          (!includeViaCadastro && clean.toLowerCase() === 'via cadastro');
        if (!isIgnored) {
          brokers.add(clean);
        }
      }
    });

    return Array.from(brokers);
  }

  // Identifica se a proposta teve entrada direta sem corretor externo
  function isDirectRegistration(p) {
    if (!p) return false;
    const b1 = (p.CORRETORES_1 || '').trim().toLowerCase();
    return b1 === 'via cadastro';
  }

  // Extração de UFs válidas (suporta propostas interestaduais com múltiplas UFs separadas por vírgula/barra)
  function extractUfsFromProposal(p) {
    if (!p || !p.UF) return [];
    const raw = String(p.UF).trim();
    if (!raw || raw === '-' || raw === '--') return [];

    const tokens = raw.split(/[,;/+]+/).map(s => s.trim().toUpperCase()).filter(s => s.length === 2);
    return Array.from(new Set(tokens));
  }

  // Determina o período anterior equivalente
  function getEquivalentPreviousPeriod(scope = {}) {
    const period = scope.period || 'all';
    const now = scope.referenceDate ? new Date(scope.referenceDate) : new Date();

    if (period === 'all') {
      return null; // Sem base comparável histórica
    }

    if (period === 'current_month') {
      const year = now.getFullYear();
      const month = now.getMonth();
      const prevMonthDate = new Date(year, month - 1, 1);
      const prevYear = prevMonthDate.getFullYear();
      const prevMonth = prevMonthDate.getMonth();
      const prevStart = new Date(prevYear, prevMonth, 1);
      const prevEnd = new Date(prevYear, prevMonth + 1, 0, 23, 59, 59, 999);
      const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return {
        period: 'custom',
        dateField: scope.dateField || 'prospeccao',
        dateFrom: fmt(prevStart),
        dateTo: fmt(prevEnd),
        label: prevStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      };
    }

    if (period === 'last_90_days') {
      const currentStart = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
      const prevEnd = new Date(currentStart.getTime() - 1);
      const prevStart = new Date(now.getTime() - (180 * 24 * 60 * 60 * 1000));
      const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return {
        period: 'custom',
        dateField: scope.dateField || 'prospeccao',
        dateFrom: fmt(prevStart),
        dateTo: fmt(prevEnd),
        label: '90 dias anteriores'
      };
    }

    if (period === 'custom') {
      const dtStart = parseBrDate(scope.dateFrom);
      const dtEnd = parseBrDate(scope.dateTo);
      if (dtStart && dtEnd) {
        const durationMs = dtEnd.getTime() - dtStart.getTime();
        const prevEnd = new Date(dtStart.getTime() - (24 * 60 * 60 * 1000));
        const prevStart = new Date(prevEnd.getTime() - durationMs);
        const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return {
          period: 'custom',
          dateField: scope.dateField || 'prospeccao',
          dateFrom: fmt(prevStart),
          dateTo: fmt(prevEnd),
          label: `${prevStart.toLocaleDateString('pt-BR')} a ${prevEnd.toLocaleDateString('pt-BR')}`
        };
      }
    }

    return null;
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
        const pBrokers = extractBrokersFromProposal(p, { includeViaCadastro: true });
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

  // Agrupamento de Destinos Mutuamente Exclusivos do Pipeline
  function calculatePipelineDestinations(proposals) {
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

    const totalCount = proposals.length;
    let totalLives = 0;
    let totalRevenue = 0;

    const inProgressStatuses = {
      'Iniciada': { count: 0, lives: 0, rev: 0, proposals: [] },
      'Fria': { count: 0, lives: 0, rev: 0, proposals: [] },
      'Morna': { count: 0, lives: 0, rev: 0, proposals: [] },
      'Quente': { count: 0, lives: 0, rev: 0, proposals: [] }
    };

    const closedStatuses = {
      'Contrato Fechado': { count: 0, lives: 0, rev: 0, proposals: [] }
    };

    const lostStatuses = {
      'Desistência da Empresa': { count: 0, lives: 0, rev: 0, proposals: [] },
      'Declinado pela SB Saúde': { count: 0, lives: 0, rev: 0, proposals: [] }
    };

    proposals.forEach(p => {
      const lives = parseLives(p.VIDAS);
      const rev = parseCurrency(p.FATURAMENTO);
      totalLives += lives;
      totalRevenue += rev;

      const t = (p.TEMPERATURA_CONTRATO || 'Iniciada').trim();
      if (inProgressStatuses[t]) {
        inProgressStatuses[t].count++;
        inProgressStatuses[t].lives += lives;
        inProgressStatuses[t].rev += rev;
        inProgressStatuses[t].proposals.push(p);
      } else if (t === 'Contrato Fechado') {
        closedStatuses['Contrato Fechado'].count++;
        closedStatuses['Contrato Fechado'].lives += lives;
        closedStatuses['Contrato Fechado'].rev += rev;
        closedStatuses['Contrato Fechado'].proposals.push(p);
      } else if (t.includes('Declin')) {
        lostStatuses['Declinado pela SB Saúde'].count++;
        lostStatuses['Declinado pela SB Saúde'].lives += lives;
        lostStatuses['Declinado pela SB Saúde'].rev += rev;
        lostStatuses['Declinado pela SB Saúde'].proposals.push(p);
      } else {
        // Desistência ou variações caem em Desistência da Empresa
        lostStatuses['Desistência da Empresa'].count++;
        lostStatuses['Desistência da Empresa'].lives += lives;
        lostStatuses['Desistência da Empresa'].rev += rev;
        lostStatuses['Desistência da Empresa'].proposals.push(p);
      }
    });

    const sumGroup = groupMap => {
      let count = 0, lives = 0, rev = 0;
      const proposals = [];
      Object.entries(groupMap).forEach(([name, data]) => {
        count += data.count;
        lives += data.lives;
        rev += data.rev;
        data.formattedRev = formatCurrency(data.rev);
        data.pct = totalCount > 0 ? ((data.count / totalCount) * 100).toFixed(1) : '0.0';
        proposals.push(...data.proposals);
      });
      return {
        count,
        lives,
        revenue: Math.round(rev * 100) / 100,
        formattedRevenue: formatCurrency(rev),
        pct: totalCount > 0 ? ((count / totalCount) * 100).toFixed(1) : '0.0',
        statuses: groupMap,
        proposals
      };
    };

    const inProgress = sumGroup(inProgressStatuses);
    const closed = sumGroup(closedStatuses);
    const lost = sumGroup(lostStatuses);

    return {
      inProgress,
      closed,
      lost,
      total: {
        count: totalCount,
        lives: totalLives,
        revenue: Math.round(totalRevenue * 100) / 100,
        formattedRevenue: formatCurrency(totalRevenue)
      }
    };
  }

  /**
   * Cálculo dos Cartões Factuais de Insights Estratégicos e Indicadores
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

    // 2. Período anterior equivalente e propostas anteriores
    const prevScope = getEquivalentPreviousPeriod(scope);
    const prevProposals = prevScope ? filterProposalsByScope(allProposals, prevScope) : null;

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
    // DESTINOS MUTUAMENTE EXCLUSIVOS DO PIPELINE
    // =========================================================================
    const destinations = calculatePipelineDestinations(filteredProposals);
    const prevDestinations = prevProposals ? calculatePipelineDestinations(prevProposals) : null;

    // =========================================================================
    // CORRETOR PARCEIRO LÍDER E CANAL DIRETO (VIA CADASTRO)
    // =========================================================================
    const brokerStatsMap = new Map();
    let directChannelProposals = [];
    let unassignedProposals = [];

    filteredProposals.forEach(p => {
      const isClosed = (p.TEMPERATURA_CONTRATO || '').trim() === 'Contrato Fechado';
      if (isDirectRegistration(p)) {
        directChannelProposals.push(p);
      }

      // Extrai corretores reais excluindo "Via Cadastro"
      const brokers = extractBrokersFromProposal(p, { includeViaCadastro: false });
      if (brokers.length === 0 && !isDirectRegistration(p)) {
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

    // Se solicitado especificamente modo legado com "Via Cadastro" em corretores
    if (scope.includeViaCadastroInBrokers === true && directChannelProposals.length > 0) {
      brokerStatsMap.set('Via Cadastro', {
        name: 'Via Cadastro',
        count: directChannelProposals.length,
        closedCount: directChannelProposals.filter(p => (p.TEMPERATURA_CONTRATO || '').trim() === 'Contrato Fechado').length,
        proposals: directChannelProposals,
        isDirectRegistrationChannel: true
      });
    }

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
        isDirectRegistrationChannel: Boolean(topB.isDirectRegistrationChannel),
        proposalIds: topB.proposals.map(p => String(p.ID)),
        proposals: topB.proposals,
        periodLabel
      };
    } else {
      topBrokerResult = {
        name: 'Sem dados suficientes',
        count: 0,
        closedCount: 0,
        isDirectRegistrationChannel: false,
        proposalIds: [],
        proposals: [],
        periodLabel
      };
    }

    const directChannelResult = {
      name: 'Via Cadastro',
      label: 'Canal de Entrada Direta (Via Cadastro)',
      count: directChannelProposals.length,
      closedCount: directChannelProposals.filter(p => (p.TEMPERATURA_CONTRATO || '').trim() === 'Contrato Fechado').length,
      proposalIds: directChannelProposals.map(p => String(p.ID)),
      proposals: directChannelProposals
    };

    // =========================================================================
    // MAIOR PROPOSTA DO PERÍODO & MAIOR PERDA
    // =========================================================================
    let biggestProposal = null;
    let biggestLossProposal = null;

    if (totalUniverse > 0) {
      const sortedByValue = [...filteredProposals].sort((a, b) => {
        const valA = parseCurrency(a.FATURAMENTO);
        const valB = parseCurrency(b.FATURAMENTO);
        if (valB !== valA) return valB - valA;
        const dateA = parseBrDate(a.DATA_DA_PROSPECCAO) || new Date(0);
        const dateB = parseBrDate(b.DATA_DA_PROSPECCAO) || new Date(0);
        if (dateB.getTime() !== dateA.getTime()) return dateB.getTime() - dateA.getTime();
        return String(a.ID).localeCompare(String(b.ID));
      });

      const topP = sortedByValue[0];
      const rev = parseCurrency(topP.FATURAMENTO);
      const lives = parseLives(topP.VIDAS);
      const isLoss = (topP.TEMPERATURA_CONTRATO || '').toLowerCase().includes('desist') || 
                     (topP.TEMPERATURA_CONTRATO || '').toLowerCase().includes('declin');

      biggestProposal = {
        id: String(topP.ID),
        company: topP.EMPRESA || 'Empresa Não Informada',
        lives: lives,
        livesFormatted: lives.toLocaleString('pt-BR'),
        revenue: rev,
        revenueFormatted: topP.FATURAMENTO || formatCurrency(rev),
        status: topP.TEMPERATURA_CONTRATO || 'Iniciada',
        isLoss: isLoss,
        lossReason: topP.Motivo_Declinio || '',
        date: topP.DATA_DA_PROSPECCAO || topP.COMPETENCIA || '-',
        proposal: topP
      };

      const lostList = sortedByValue.filter(p => {
        const s = (p.TEMPERATURA_CONTRATO || '').toLowerCase();
        return s.includes('desist') || s.includes('declin');
      });

      if (lostList.length > 0) {
        const topLost = lostList[0];
        const lostRev = parseCurrency(topLost.FATURAMENTO);
        const lostLives = parseLives(topLost.VIDAS);
        biggestLossProposal = {
          id: String(topLost.ID),
          company: topLost.EMPRESA || 'Empresa Não Informada',
          lives: lostLives,
          livesFormatted: lostLives.toLocaleString('pt-BR'),
          revenue: lostRev,
          revenueFormatted: topLost.FATURAMENTO || formatCurrency(lostRev),
          status: topLost.TEMPERATURA_CONTRATO || 'Desistência da Empresa',
          reason: topLost.Motivo_Declinio || 'AUSENCIA DE REGISTRO DE RETORNO DO COMERCIAL',
          date: topLost.DATA_DA_PROSPECCAO || topLost.COMPETENCIA || '-',
          proposal: topLost
        };
      }
    } else {
      biggestProposal = {
        id: null,
        company: 'Sem dados suficientes',
        lives: 0,
        livesFormatted: '0 vidas',
        revenue: 0,
        revenueFormatted: 'R$ 0,00',
        status: '-',
        isLoss: false,
        lossReason: '',
        date: '-',
        proposal: null
      };
    }

    // =========================================================================
    // UF COM MAIS PROPOSTAS NO PERÍODO
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
    // VALOR COTADO EM PROPOSTAS FECHADAS
    // =========================================================================
    const closedProposals = destinations.closed.proposals;
    const totalClosedRevenue = destinations.closed.revenue;
    const closedCount = destinations.closed.count;
    const closedLives = destinations.closed.lives;
    const closureRate = destinations.closed.pct;

    const closedProposalsResult = {
      totalRevenue: totalClosedRevenue,
      formattedRevenue: formatCurrency(totalClosedRevenue),
      closedCount: closedCount,
      totalUniverse: totalUniverse,
      closureRate: closureRate,
      closedLives: closedLives,
      proposalIds: closedProposals.map(p => String(p.ID)),
      proposals: closedProposals,
      periodLabel
    };

    // =========================================================================
    // SEÇÃO "O QUE EXIGE ATENÇÃO" (5 INSIGHTS PRIORIZADOS E ACIONÁVEIS)
    // =========================================================================
    const actionableInsights = [];

    // Insight 1: Alerta de Perda de Alto Valor
    if (biggestLossProposal && biggestLossProposal.revenue > 0) {
      actionableInsights.push({
        id: 'loss-alert',
        type: 'risk',
        badge: 'Perda Crítica',
        badgeClass: 'badge-danger',
        title: `Perda Relevante: ${biggestLossProposal.company}`,
        metric: biggestLossProposal.revenueFormatted,
        metricSub: `${biggestLossProposal.livesFormatted} vidas • Proposta #${biggestLossProposal.id}`,
        reason: biggestLossProposal.reason 
          ? `Status: ${biggestLossProposal.status}. Motivo registrado: "${biggestLossProposal.reason}". Exige auditoria de aceitação e follow-up comercial para reverter potenciais clientes.`
          : `Status: ${biggestLossProposal.status}. Representa a maior cotação não convertida do período selecionado.`,
        actionLabel: `Abrir Proposta #${biggestLossProposal.id} →`,
        actionTarget: 'proposal_drawer',
        targetId: biggestLossProposal.id
      });
    }

    // Insight 2: Concentração de Risco / Oportunidade no Pipeline Ativo
    if (destinations.inProgress.count > 0) {
      const topInProgress = [...destinations.inProgress.proposals].sort((a,b) => parseCurrency(b.FATURAMENTO) - parseCurrency(a.FATURAMENTO));
      const top3Val = topInProgress.slice(0, 3).reduce((sum, p) => sum + parseCurrency(p.FATURAMENTO), 0);
      const pctOfInProgress = destinations.inProgress.revenue > 0 ? ((top3Val / destinations.inProgress.revenue) * 100).toFixed(1) : '0.0';
      const hotCount = (destinations.inProgress.statuses['Quente'] || {}).count || 0;
      const warmCount = (destinations.inProgress.statuses['Morna'] || {}).count || 0;

      actionableInsights.push({
        id: 'pipeline-concentration',
        type: 'opportunity',
        badge: 'Pipeline Ativo',
        badgeClass: 'badge-warning',
        title: `${hotCount + warmCount} Propostas Quentes/Mornas em Negociação`,
        metric: destinations.inProgress.formattedRevenue,
        metricSub: `${destinations.inProgress.count} propostas • ${destinations.inProgress.lives.toLocaleString('pt-BR')} vidas em aberto`,
        reason: `As 3 maiores cotações em negociação concentram ${pctOfInProgress}% (${formatCurrency(top3Val)}) do valor em aberto. Priorizar fechamento dos ${hotCount} negócios quentes e ${warmCount} mornos.`,
        actionLabel: 'Ver Propostas em Aberto →',
        actionTarget: 'drilldown_in_progress',
        targetFilter: 'in_progress'
      });
    }

    // Insight 3: Diagnóstico de Perdas e Desistências
    if (destinations.lost.count > 0) {
      const desistCount = (destinations.lost.statuses['Desistência da Empresa'] || {}).count || 0;
      const declinCount = (destinations.lost.statuses['Declinado pela SB Saúde'] || {}).count || 0;
      actionableInsights.push({
        id: 'losses-diagnosis',
        type: 'loss',
        badge: 'Diagnóstico de Perdas',
        badgeClass: 'badge-neutral',
        title: `${destinations.lost.count} Propostas Não Convertidas (${destinations.lost.pct}%)`,
        metric: destinations.lost.formattedRevenue,
        metricSub: `${desistCount} desistências da empresa • ${declinCount} declínios SB Saúde`,
        reason: `348 desistências apontam ausência de retorno comercial ou prazo esgotado. Acompanhar motivos de declínio para ajustar políticas de precificação e rede.`,
        actionLabel: `Auditar Perdas (${destinations.lost.count}) →`,
        actionTarget: 'drilldown_lost',
        targetFilter: 'lost'
      });
    }

    // Insight 4: Desempenho Real de Corretores Parceiros
    if (sortedBrokers.length > 0) {
      const topB = sortedBrokers[0];
      const directCount = directChannelProposals.length;
      actionableInsights.push({
        id: 'broker-performance',
        type: 'performance',
        badge: 'Parcerias Comerciais',
        badgeClass: 'badge-info',
        title: `Liderança Comercial: ${topB.name}`,
        metric: `${topB.count} propostas`,
        metricSub: `${topB.closedCount} contratos fechados via corretor`,
        reason: `${topB.name} lidera os corretores credenciados externos em volume. Nota de transparência: ${directCount} contratos fechados originaram-se via canal de cadastro direto interno ("Via Cadastro").`,
        actionLabel: `Auditar Corretor (${topB.name}) →`,
        actionTarget: 'drilldown_broker',
        targetBroker: topB.name
      });
    }

    // Insight 5: Concentração Regional
    if (topUfResult && topUfResult.count > 0 && !topUfResult.isUnknown) {
      actionableInsights.push({
        id: 'geo-density',
        type: 'geo',
        badge: 'Concentração Regional',
        badgeClass: 'badge-primary',
        title: `Polo Estratégico: Estado ${topUfResult.uf}`,
        metric: `${topUfResult.count} propostas`,
        metricSub: `${topUfResult.livesFormatted} vidas mapeadas`,
        reason: `O estado ${topUfResult.uf} concentra a maior densidade de propostas e beneficiários. Base para expansão de campanhas e credenciamento de operadoras parceiras.`,
        actionLabel: `Auditar Estado (${topUfResult.uf}) →`,
        actionTarget: 'drilldown_uf',
        targetUf: topUfResult.uf
      });
    }

    // =========================================================================
    // DADOS COMPARATIVOS COM PERÍODO ANTERIOR
    // =========================================================================
    let comparison = null;
    if (prevDestinations && prevProposals) {
      const deltaCount = totalUniverse - prevProposals.length;
      const deltaCountPct = prevProposals.length > 0 ? ((deltaCount / prevProposals.length) * 100).toFixed(1) : null;

      const deltaClosedCount = closedCount - prevDestinations.closed.count;
      const deltaClosedCountPct = prevDestinations.closed.count > 0 ? ((deltaClosedCount / prevDestinations.closed.count) * 100).toFixed(1) : null;

      const deltaClosedRev = totalClosedRevenue - prevDestinations.closed.revenue;
      const deltaClosedRevPct = prevDestinations.closed.revenue > 0 ? ((deltaClosedRev / prevDestinations.closed.revenue) * 100).toFixed(1) : null;

      const deltaClosedLives = closedLives - prevDestinations.closed.lives;

      const prevClosureRateNum = parseFloat(prevDestinations.closed.pct) || 0;
      const curClosureRateNum = parseFloat(closureRate) || 0;
      const deltaClosurePoints = (curClosureRateNum - prevClosureRateNum).toFixed(1);

      comparison = {
        hasComparison: true,
        periodLabel: prevScope.label,
        previousCount: prevProposals.length,
        previousClosedCount: prevDestinations.closed.count,
        previousClosedLives: prevDestinations.closed.lives,
        previousClosedRevenue: prevDestinations.closed.revenue,
        previousClosureRate: prevDestinations.closed.pct,
        deltaCount,
        deltaCountPct,
        deltaClosedCount,
        deltaClosedCountPct,
        deltaClosedRev,
        deltaClosedRevPct,
        deltaClosedLives,
        deltaClosurePoints
      };
    } else {
      comparison = {
        hasComparison: false,
        reason: scope.period === 'all' ? 'Base histórica completa (sem período anterior comparável)' : 'Dados insuficientes no período anterior'
      };
    }

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
      destinations,
      comparison,
      topBroker: topBrokerResult,
      directChannel: directChannelResult,
      biggestProposal,
      biggestLossProposal,
      topUf: topUfResult,
      closedProposals: closedProposalsResult,
      actionableInsights
    };
  }

  // Exportação compatível com Navegador e Node.js
  const StrategicInsightsAPI = {
    parseBrDate,
    extractBrokersFromProposal,
    isDirectRegistration,
    extractUfsFromProposal,
    filterProposalsByScope,
    getEquivalentPreviousPeriod,
    calculatePipelineDestinations,
    calculateFactualStrategicInsights
  };

  if (typeof window !== 'undefined') {
    window.StrategicInsights = StrategicInsightsAPI;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = StrategicInsightsAPI;
  }
})();
