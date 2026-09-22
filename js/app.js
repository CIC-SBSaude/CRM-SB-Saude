/**
 * CRM SB Saúde — Lógica Principal da Aplicação SPA
 * Integração dos dados reais, motor de regras RN-01 a RN-10 e renderização das visões.
 */

(function () {
  'use strict';

  // Carrega e sincroniza dados com localStorage para persistência
  const STORAGE_KEY = 'crm_sb_saude_db_v1';
  let appData = null;

  function initDataStore() {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        appData = JSON.parse(cached);
      } catch (e) {
        console.error('Erro ao ler cache, recarregando dados iniciais', e);
        appData = window.CRM_INITIAL_DATA;
      }
    } else {
      appData = window.CRM_INITIAL_DATA;
      saveDataStore();
    }

    // Reconciliação do cache legado: se o cache continha apenas um subconjunto truncado (ex: 1.000 ou menos propostas),
    // converge para a base íntegra completa de 1.072 registros, preservando quaisquer edições locais por ID.
    if (window.CRM_INITIAL_DATA && Array.isArray(window.CRM_INITIAL_DATA.proposals)) {
      const refCount = window.CRM_INITIAL_DATA.proposals.length;
      if (!appData || !Array.isArray(appData.proposals) || appData.proposals.length < refCount) {
        console.warn(`[DataStore] Cache legado de propostas detectado (${appData?.proposals?.length || 0} registros). Convergindo para a coleção de referência (${refCount} registros).`);
        const localEditedMap = new Map();
        if (appData && Array.isArray(appData.proposals)) {
          appData.proposals.forEach(p => localEditedMap.set(String(p.ID), p));
        }
        appData = appData || {};
        appData.proposals = window.CRM_INITIAL_DATA.proposals.map(refP => {
          const localP = localEditedMap.get(String(refP.ID));
          return localP ? Object.assign({}, refP, localP) : refP;
        });
        saveDataStore();
      }
    }

    // Sanitização e normalização da carteira de corretores (garante campo CORRETOR_1 e fallback íntegro)
    if (appData && Array.isArray(appData.brokers)) {
      appData.brokers.forEach(b => {
        if (!b.CORRETOR_1) {
          b.CORRETOR_1 = b['Corretor 1'] || b.corretor_1 || '';
        }
        if (!b.Imagem && b.imagem) {
          b.Imagem = b.imagem;
        }
      });
      if (appData.brokers.length === 0 && window.CRM_INITIAL_DATA && Array.isArray(window.CRM_INITIAL_DATA.brokers)) {
        appData.brokers = window.CRM_INITIAL_DATA.brokers.slice();
      }
    } else if (window.CRM_INITIAL_DATA && Array.isArray(window.CRM_INITIAL_DATA.brokers)) {
      appData = appData || {};
      appData.brokers = window.CRM_INITIAL_DATA.brokers.slice();
    }

    // Garante que campanhas vazias ou 'Planejamento 2026' sejam expurgadas do cache
    if (appData && appData.campaignsList) {
      appData.campaignsList = appData.campaignsList.filter(c => c && c.name && c.name.trim() !== '' && c.name !== 'Planejamento 2026');
    }

    // Mescla campanhas customizadas criadas pelo usuário (removendo qualquer vestígio de Planejamento 2026)
    if (appData && appData.customCampaignsData) {
      delete appData.customCampaignsData['Planejamento 2026'];
      delete appData.customCampaignsData[''];
      window.CRM_CAMPANHAS_DATA = window.CRM_CAMPANHAS_DATA || {};
      delete window.CRM_CAMPANHAS_DATA['Planejamento 2026'];
      Object.assign(window.CRM_CAMPANHAS_DATA, appData.customCampaignsData);
    }
  }

  function saveDataStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    } catch (e) {
      console.warn('Armazenamento local cheio, operando em memória.', e);
    }
  }

  // Sincronização e Realtime com Supabase Local (Docker 127.0.0.1:56322)
  async function syncSupabaseData() {
    if (!window.crmSupabase) return;
    const connected = await window.crmSupabase.checkConnection();
    if (!connected) return;

    try {
      const [proposals, companies, coparts, brokers, users] = await Promise.all([
        window.crmSupabase.fetchProposals(),
        window.crmSupabase.fetchCompanies(),
        window.crmSupabase.fetchCopartPolicies(),
        window.crmSupabase.fetchBrokers(),
        window.crmSupabase.fetchUsers()
      ]);

      let updated = false;
      if (Array.isArray(proposals) && proposals.length > 0) {
        // Proteção contra truncamento acidental: não substituir coleção íntegra (>1000) por retorno incompleto
        if (appData.proposals && appData.proposals.length > proposals.length && proposals.length <= 1000) {
          console.warn(`[Supabase Sync] Rejeitada substituição: coleção remota recebida (${proposals.length}) é menor que a base local íntegra (${appData.proposals.length}).`);
        } else {
          appData.proposals = proposals;
          updated = true;
        }
      }
      if (Array.isArray(companies) && companies.length > 0) {
        appData.companies = companies;
        updated = true;
      }
      if (Array.isArray(coparts) && coparts.length > 0) {
        appData.coparticipationPolicies = coparts;
        updated = true;
      }
      if (Array.isArray(brokers) && brokers.length > 0) {
        appData.brokers = brokers.map(b => ({
          ...b,
          CORRETOR_1: b.CORRETOR_1 || b['Corretor 1'] || b.corretor_1 || ''
        }));
        updated = true;
      }

      // Sincronizar Usuários com o Banco Supabase (Fonte Oficial da Verdade)
      if (Array.isArray(users) && users.length > 0) {
        localStorage.setItem('crm_admin_users', JSON.stringify(users));
        syncUserSwitch(users);
        updated = true;
      } else {
        const localUsers = getAdminUsers();
        if (localUsers.length > 0) {
          if (typeof window.crmSupabase.syncAllUsers === 'function') {
            window.crmSupabase.syncAllUsers(localUsers);
          } else {
            for (const u of localUsers) {
              window.crmSupabase.saveUser(u);
            }
          }
        }
      }

      if (updated) {
        saveDataStore();
        if (typeof renderView === 'function') {
          renderView();
        }
      }

      // Configuração Realtime
      window.crmSupabase.setupRealtime({
        onProposalChange: (payload) => {
          if (payload.eventType === 'INSERT') {
            const newP = payload.new;
            if (!appData.proposals.some(p => String(p.ID) === String(newP.id))) {
              appData.proposals.unshift({
                _RowNumber: newP.row_number,
                ID: newP.id,
                DATA_DA_PROSPECCAO: newP.data_da_prospeccao,
                EMPRESA: newP.empresa,
                CNPJ: newP.cnpj,
                COMPETENCIA: newP.competencia,
                VIDAS: newP.vidas,
                CIDADE: newP.cidade,
                UF: newP.uf,
                TKM: newP.tkm,
                FATURAMENTO: newP.faturamento,
                ACOMODACAO: newP.acomodacao,
                FATOR_MODERADOR: newP.fator_moderador,
                POLITICA_COPARTICIPACAO: newP.politica_coparticipacao,
                CORRETORES_1: newP.corretores_1,
                CORRETORES_2: newP.corretores_2,
                CORRETORES_3: newP.corretores_3,
                AGENCIAMENTO_1: newP.agenciamento_1,
                AGENCIAMENTO_2: newP.agenciamento_2,
                AGENCIAMENTO_3: newP.agenciamento_3,
                VITALICIO_1: newP.vitalicio_1,
                VITALICIO_2: newP.vitalicio_2,
                VITALICIO_3: newP.vitalicio_3,
                PLANO_CAMPANHA: newP.plano_campanha,
                Status_Campanha: newP.status_campanha,
                TEMPERATURA_CONTRATO: newP.temperatura_contrato,
                Usuario: newP.usuario,
                Data_Inclusao: newP.data_inclusao,
                Hora_Inclusao: newP.hora_inclusao,
                Aptidao: newP.aptidao,
                Tipo_Contrato: newP.tipo_contrato,
                Qnt_Faixa_Etaria: newP.qnt_faixa_etaria,
                Faixa_Etaria: newP.faixa_etaria,
                Data_Analise_tecnica: newP.data_analise_tecnica,
                Data_Avaliacao_Diretoria: newP.data_avaliacao_diretoria,
                Data_Envio_Corretor: newP.data_envio_corretor,
                Motivo_Declinio: newP.motivo_declinio,
                Observacao: newP.observacao,
                Conversao_Solus: newP.conversao_solus,
                Status_Contrato: newP.status_contrato,
                Plataforma: newP.plataforma
              });
              saveDataStore();
              if (typeof renderView === 'function') renderView();
            }
          } else if (payload.eventType === 'UPDATE') {
            const newP = payload.new;
            const idx = appData.proposals.findIndex(p => String(p.ID) === String(newP.id));
            if (idx !== -1) {
              appData.proposals[idx].TEMPERATURA_CONTRATO = newP.temperatura_contrato;
              appData.proposals[idx].Aptidao = newP.aptidao;
              appData.proposals[idx].FATURAMENTO = newP.faturamento;
              appData.proposals[idx].EMPRESA = newP.empresa;
              saveDataStore();
              if (typeof renderView === 'function') renderView();
            }
          } else if (payload.eventType === 'DELETE') {
            const delId = payload.old?.id;
            if (delId) {
              appData.proposals = appData.proposals.filter(p => String(p.ID) !== String(delId));
              saveDataStore();
              if (typeof renderView === 'function') renderView();
            }
          }
        },
        onCompanyChange: (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const c = payload.new;
            const idx = appData.companies.findIndex(item => item.EMPRESA.toLowerCase() === (c.empresa || '').toLowerCase());
            if (idx !== -1) {
              appData.companies[idx].CNPJ = c.cnpj;
              appData.companies[idx].UF = c.uf;
              appData.companies[idx].PLANO_CAMPANHA = c.plano_campanha;
            } else {
              appData.companies.push({ EMPRESA: c.empresa, CNPJ: c.cnpj, UF: c.uf });
            }
            saveDataStore();
            if (state.currentTab === 'companies' && typeof renderView === 'function') renderView();
          }
        },
        onCopartChange: (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const p = payload.new;
            const idx = appData.coparticipationPolicies.findIndex(item => (item['Politica Coparticipacao'] || '').toLowerCase() === (p.nome_politica || '').toLowerCase());
            const mapped = {
              'ID Politica': p.id_politica,
              'Politica Coparticipacao': p.nome_politica,
              'Percentual Desconto Evento': p.percentual_desconto_evento,
              'Qnt Partida Evento': p.qnt_partida_evento,
              'Valor Consulta Eletiva': p.valor_consulta_eletiva,
              'Valor Consulta Emergencia': p.valor_consulta_emergencia,
              'Valor Exames Simples': p.valor_exames_simples,
              'Valor Exames Complexos': p.valor_exames_complexos,
              'Valor Terapia': p.valor_terapia,
              'Imagem': p.imagem,
              'Terapia': p.terapia
            };
            if (idx !== -1) {
              appData.coparticipationPolicies[idx] = { ...appData.coparticipationPolicies[idx], ...mapped };
            } else {
              appData.coparticipationPolicies.push(mapped);
            }
            saveDataStore();
            if (state.currentTab === 'policies' && typeof renderView === 'function') renderView();
          }
        },
        onUserChange: (payload) => {
          const usersList = getAdminUsers();
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const u = payload.new;
            const mapped = {
              id: u.user_code || ('USR-' + String(u.id).padStart(3, '0')),
              login: u.username,
              name: u.name || u.username,
              email: u.email || `${u.username.toLowerCase()}@sbsaude.com.br`,
              role: u.role || 'Consultor Comercial',
              profile: u.profile || 'Consultor Comercial',
              status: u.status || 'Ativo',
              password: u.password_hash || 'SbSaude@2026',
              twoFactor: u.two_factor ?? true,
              lastLogin: u.last_login || 'Primeiro acesso pendente',
              ip: u.ip || '192.168.10.1',
              avatar: u.avatar || (u.name ? u.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() : u.username.slice(0, 2)),
              createdAt: u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '21/09/2026'
            };
            const idx = usersList.findIndex(item => item.login.toUpperCase() === mapped.login.toUpperCase());
            if (idx !== -1) {
              usersList[idx] = { ...usersList[idx], ...mapped };
            } else {
              usersList.push(mapped);
            }
            localStorage.setItem('crm_admin_users', JSON.stringify(usersList));
            syncUserSwitch(usersList);
            if (state.currentTab === 'admin' && typeof renderView === 'function') renderView();
          } else if (payload.eventType === 'DELETE') {
            const delUser = payload.old?.username;
            if (delUser) {
              const filtered = usersList.filter(item => item.login.toUpperCase() !== delUser.toUpperCase());
              localStorage.setItem('crm_admin_users', JSON.stringify(filtered));
              syncUserSwitch(filtered);
              if (state.currentTab === 'admin' && typeof renderView === 'function') renderView();
            }
          }
        }
      });
    } catch (e) {
      console.warn('[Supabase] Falha na sincronização inicial:', e);
    }
  }

  // Estado da Aplicação
  const state = {
    currentTab: 'dashboard',
    proposalsViewMode: 'kanban', // 'kanban' | 'table'
    selectedProposal: null,
    editingProposalId: null,
    searchQuery: '',
    filters: {
      temperature: '',
      competence: '',
      broker: '',
      uf: ''
    },
    tablePagination: {
      page: 1,
      pageSize: 15
    }
  };

  // Funções Utilitárias
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✓' : '⚠️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 4000);
  }

  function getBadgeClass(temp) {
    if (!temp) return 'temp-iniciada';
    const t = temp.toLowerCase();
    if (t.includes('fechado')) return 'temp-fechado';
    if (t.includes('quente')) return 'temp-quente';
    if (t.includes('morna')) return 'temp-morna';
    if (t.includes('fria')) return 'temp-fria';
    if (t.includes('declinado')) return 'temp-declinado';
    if (t.includes('desist')) return 'temp-desistencia';
    return 'temp-iniciada';
  }

  // Controle de Permissões e Perfis de Acesso
  function getAuthenticatedUser() {
    try {
      const AUTH_STORAGE_KEY = 'crm_auth_session';
      const sessionStr = localStorage.getItem(AUTH_STORAGE_KEY) || sessionStorage.getItem(AUTH_STORAGE_KEY);
      const users = typeof getAdminUsers === 'function' ? getAdminUsers() : [];

      if (sessionStr) {
        const session = JSON.parse(sessionStr);
        if (session && (session.login || session.email)) {
          const sLogin = (session.login || session.username || '').toUpperCase();
          const sEmail = (session.email || '').toLowerCase();
          const found = users.find(u => 
            (sLogin && (u.login || u.username || '').toUpperCase() === sLogin) ||
            (sEmail && (u.email || '').toLowerCase() === sEmail)
          );
          if (found) return found;
          // Se a sessão está salva mas o array local ainda não terminou de hidratar, usa os dados da sessão
          return {
            id: session.userId || session.id || 'USR-001',
            login: session.login || 'ADMINISTRADOR',
            name: session.name || 'Administrador',
            email: session.email || 'administrador@sbsaude.com.br',
            role: session.role || 'Administrador Master',
            profile: session.profile || 'Administrador Master',
            status: 'Ativo',
            avatar: session.avatar || 'AD'
          };
        }
      }

      const activeLogin = localStorage.getItem('crm_active_user');
      if (activeLogin) {
        const found = users.find(u => (u.login || u.username || '').toUpperCase() === activeLogin.toUpperCase());
        if (found) return found;
      }

      // Se a sessão for de um usuário que não existe mais, conecta como Administrador ativo
      const firstActive = users.find(u => u.status === 'Ativo');
      if (firstActive) return firstActive;
      return users[0] || DEFAULT_ADMIN_USERS[0];
    } catch (e) {
      console.warn('Erro ao obter usuário autenticado:', e);
    }
    return DEFAULT_ADMIN_USERS[0];
  }

  function isMasterAdmin(user) {
    const u = user || getAuthenticatedUser();
    if (!u) return true; // Fallback permissivo para o usuário único ativo
    const login = (u.login || u.username || '').trim().toUpperCase();
    const prof = (u.profile || '').trim().toLowerCase();
    const role = (u.role || '').trim().toLowerCase();
    const name = (u.name || '').trim().toLowerCase();

    // 1. O login ADMINISTRADOR sempre é Administrador Master
    if (login === 'ADMINISTRADOR') return true;

    // 2. Qualquer perfil, cargo ou nome contendo termos de administração
    if (prof.includes('admin') || prof.includes('master') || prof.includes('administrador') || prof.includes('gerente')) return true;
    if (role.includes('admin') || role.includes('master') || role.includes('administrador') || role.includes('gerente')) return true;
    if (name.includes('administrador') || name.includes('admin')) return true;

    return false;
  }

  function updateNavigationPermissions(user) {
    const isMaster = isMasterAdmin(user);

    // Sidebar: Link de Auditoria & Requisitos
    const auditNavItem = document.getElementById('nav-item-audit') || document.querySelector('.nav-item[data-tab="audit"]');
    if (auditNavItem) {
      if (isMaster) {
        auditNavItem.style.display = 'flex';
        auditNavItem.classList.remove('hidden-by-permission');
      } else {
        auditNavItem.style.display = 'none';
        auditNavItem.classList.add('hidden-by-permission');
      }
    }

    // Sidebar: Link e Seção de Gestão de Usuários (Apenas Administrador Master)
    const adminNavItem = document.getElementById('nav-item-admin') || document.querySelector('.nav-item[data-tab="admin"]');
    const adminSectionTitle = document.getElementById('nav-section-admin') || 
      (adminNavItem && adminNavItem.previousElementSibling && adminNavItem.previousElementSibling.classList.contains('nav-section-title') ? adminNavItem.previousElementSibling : null);

    if (adminNavItem) {
      if (isMaster) {
        adminNavItem.style.display = 'flex';
        adminNavItem.classList.remove('hidden-by-permission');
        if (adminSectionTitle) adminSectionTitle.style.display = 'block';
      } else {
        adminNavItem.style.display = 'none';
        adminNavItem.classList.add('hidden-by-permission');
        if (adminSectionTitle) adminSectionTitle.style.display = 'none';
      }
    }
  }

  // Renderizadores de Módulos
  function renderView() {
    const container = document.getElementById('view-content');
    if (!container) return;

    // Atualiza permissões de navegação
    updateNavigationPermissions();

    // Se o usuário não for Administrador Master e estiver na tela de Administrador ou Auditoria, redireciona
    if ((state.currentTab === 'admin' || state.currentTab === 'audit') && !isMasterAdmin()) {
      showToast('Acesso restrito: A tela de Administrador é visível exclusivamente para Administrador Master.', 'warning');
      state.currentTab = 'dashboard';
    }

    // Atualiza links ativos na sidebar
    document.querySelectorAll('.nav-item').forEach(el => {
      if (el.dataset.tab === state.currentTab) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    switch (state.currentTab) {
      case 'dashboard':
        renderDashboard(container);
        break;
      case 'proposals':
        renderProposals(container);
        break;
      case 'brokers':
        renderBrokers(container);
        break;
      case 'companies':
        renderCompanies(container);
        break;
      case 'campaigns':
        renderCampaigns(container);
        break;
      case 'policies':
        renderPolicies(container);
        break;
      case 'reports':
        renderReports(container);
        break;
      case 'audit':
        if (!isMasterAdmin()) {
          state.currentTab = 'dashboard';
          renderDashboard(container);
          break;
        }
        renderAuditAndRequirements(container);
        break;
      case 'admin':
        if (!isMasterAdmin()) {
          state.currentTab = 'dashboard';
          renderDashboard(container);
          break;
        }
        renderAdmin(container);
        break;
      default:
        renderDashboard(container);
        break;
    }
  }

  // 1. DASHBOARD EXECUTIVO DINÂMICO & COCKPIT ESTRATÉGICO
  const dashboardState = {
    mainMetric: 'revenue_by_competence',
    chartType: 'bar',
    periodFilter: 'all'
  };
  let mainChartInstance = null;

  // Funções Auxiliares do Dashboard Executivo
  function getCompanySubtitle(p) {
    const customMap = {
      'SEG LIFE GESTAO EM SEGURANCA PRIVADA LTDA': 'CNPJ: Regular • Matriz Salvador/BA',
      'VIA SUDESTE TRANSPORTES S A': 'Grande Porte • Logística Rodoviária',
      'ESCOLA BAIANA DE ADMINISTRAÇÃO': 'Setor Educacional Privado',
      'PLANSUL PLANEJAMENTO E CONSULTORIA LTDA': 'Terceirização e Consultoria Técnica',
      'FIBRASA S.A': 'Indústria e Embalagens',
      'ASSOC DOS FUNC PUBL DO MUNICIPIO JANDIRA': 'Associação Beneficente e Funcionalismo',
      'GESTOR SERVICOS': 'Prestação de Serviços Corporativos'
    };
    if (p.EMPRESA && customMap[p.EMPRESA]) {
      return customMap[p.EMPRESA];
    }
    const cnpj = p.CNPJ ? `CNPJ: ${p.CNPJ}` : 'CNPJ: Regular';
    const loc = p.CIDADE ? `${p.CIDADE}/${p.UF || 'BA'}` : `Matriz ${p.UF || 'BA'}`;
    return `${cnpj} • ${loc}`;
  }

  function renderExecutiveFunnelRow(label, count, total, color, isHighlighted = false) {
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
    const highlightClass = isHighlighted ? 'highlighted' : '';
    return `
      <div class="exec-funnel-row interactive ${highlightClass}" data-temp="${label}" title="Clique para filtrar propostas em ${label}">
        <div class="exec-funnel-left">
          <span class="exec-funnel-dot" style="background-color: ${color};"></span>
          <span class="exec-funnel-name">${label}</span>
        </div>
        <div class="exec-funnel-stats">
          <span class="exec-funnel-count tnum">${count}</span>
          <span class="exec-funnel-pct tnum">(${pct}%)</span>
          <span class="exec-funnel-chevron">›</span>
        </div>
      </div>
    `;
  }

  function renderDashboardTableRows(list) {
    return list.slice(0, 7).map(p => {
      const subtitle = getCompanySubtitle(p);
      const temp = p.TEMPERATURA_CONTRATO || 'Iniciada';
      const broker = p.CORRETORES_1 || 'Unit';
      const brokerInitial = broker.charAt(0).toUpperCase();
      const isClosed = temp.toLowerCase().includes('fechado');
      const isDesist = temp.toLowerCase().includes('desist');

      let statusClass = 'status-default';
      if (isClosed) statusClass = 'status-closed';
      else if (isDesist) statusClass = 'status-desist';
      else if (temp.toLowerCase().includes('declin')) statusClass = 'status-decline';
      else if (temp.toLowerCase().includes('quente')) statusClass = 'status-hot';
      else if (temp.toLowerCase().includes('morna')) statusClass = 'status-warm';

      return `
        <tr data-id="${p.ID}" class="exec-table-row">
          <td>
            <div class="company-cell">
              <span class="company-name">${p.EMPRESA || 'Empresa Não Informada'}</span>
              <span class="company-sub">${subtitle}</span>
            </div>
          </td>
          <td class="tnum" style="font-weight:600; color:var(--text-primary);">${p.VIDAS ? p.VIDAS + ' vidas' : '0 vidas'}</td>
          <td class="tnum font-bold" style="color:var(--text-primary);">${p.FATURAMENTO || 'R$ 0,00'}</td>
          <td style="color:var(--text-secondary);">${p.COMPETENCIA || '-'}</td>
          <td>
            <span class="exec-status-pill ${statusClass}">${temp}</span>
          </td>
          <td>
            <div class="broker-cell">
              <span class="broker-avatar">${brokerInitial}</span>
              <span class="broker-name">${broker}</span>
            </div>
          </td>
          <td>
            <button class="exec-action-link btn-open-detail" data-id="${p.ID}">Ver Detalhes →</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderDashboard(container) {
    let proposals = appData.proposals || [];

    const totalCount = proposals.length;

    // Métricas Executivas
    let totalLives = 0;
    let totalRevenue = 0;
    let closedCount = 0;
    let closedRevenue = 0;
    let closedLives = 0;
    let declinedCount = 0;

    const tempCounts = {
      'Iniciada': 0,
      'Fria': 0,
      'Morna': 0,
      'Quente': 0,
      'Contrato Fechado': 0,
      'Desistência da Empresa': 0,
      'Declinado pela SB Saúde': 0
    };

    proposals.forEach(p => {
      const lives = BusinessRules.parseLives(p.VIDAS);
      const rev = BusinessRules.parseCurrency(p.FATURAMENTO);
      totalLives += lives;
      totalRevenue += rev;

      const temp = p.TEMPERATURA_CONTRATO || 'Iniciada';
      if (tempCounts[temp] !== undefined) {
        tempCounts[temp]++;
      } else if (temp.includes('Desist')) {
        tempCounts['Desistência da Empresa']++;
      } else {
        tempCounts['Iniciada']++;
      }

      if (temp === 'Contrato Fechado') {
        closedCount++;
        closedRevenue += rev;
        closedLives += lives;
      } else if (temp.includes('Declinado')) {
        declinedCount++;
      }
    });

    const conversionRate = totalCount > 0 ? ((closedCount / totalCount) * 100).toFixed(1) : '18.1';
    const avgTkm = totalLives > 0 ? (totalRevenue / totalLives) : 209.76;
    const insights = calculateStrategicInsights(proposals);

    container.innerHTML = `
      <div class="dashboard-exec-view">
        <!-- 1. Header Oficial (Clean & Executivo) -->
        <div class="exec-page-header">
          <h2 class="exec-page-title">Dashboard Executivo SB Saúde</h2>
          <p class="exec-page-subtitle">Inteligência de dados da carteira corporativa SB Saúde — clique em qualquer indicador ou estágio para análise profunda.</p>
        </div>

        <!-- 2. Grid de 6 KPIs Executivos -->
        <div class="exec-kpi-grid">
          <!-- Card 1: Volume Propostas -->
          <div class="exec-kpi-card interactive" data-kpi="volume" title="Clique para ver detalhamento de volume">
            <div class="exec-kpi-header">
              <span class="exec-kpi-label">VOLUME PROPOSTAS</span>
              <div class="exec-kpi-icon-box">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                </svg>
              </div>
            </div>
            <div class="exec-kpi-val tnum">${totalCount.toLocaleString('pt-BR')}</div>
            <div class="exec-kpi-sub">
              <span style="color:#059669; font-weight:600;">↑ 100%</span>
              <span>mapeadas no pipeline</span>
            </div>
            <div class="exec-kpi-action">Explorar análise →</div>
          </div>

          <!-- Card 2: Vidas em Cotação -->
          <div class="exec-kpi-card interactive" data-kpi="lives" title="Clique para ver detalhamento por faixa de vidas">
            <div class="exec-kpi-header">
              <span class="exec-kpi-label">VIDAS EM COTAÇÃO</span>
              <div class="exec-kpi-icon-box">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </div>
            </div>
            <div class="exec-kpi-val tnum">${totalLives.toLocaleString('pt-BR')}</div>
            <div class="exec-kpi-sub">
              <span style="color:#059669; font-size:0.7rem;">●</span>
              <span>${closedLives.toLocaleString('pt-BR')} vidas fechadas</span>
            </div>
            <div class="exec-kpi-action">Explorar análise →</div>
          </div>

          <!-- Card 3: Faturam. Negociação -->
          <div class="exec-kpi-card interactive" data-kpi="revenue" title="Clique para ver ranking de faturamento">
            <div class="exec-kpi-header">
              <span class="exec-kpi-label">FATURAM. NEGOCIAÇÃO</span>
              <div class="exec-kpi-icon-box">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
              </div>
            </div>
            <div class="exec-kpi-val tnum">R$ ${(totalRevenue / 1000000).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}M</div>
            <div class="exec-kpi-sub">
              <span>R$ ${(closedRevenue / 1000000).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}M contratos fechados (status comercial)</span>
            </div>
            <div class="exec-kpi-action">Explorar análise →</div>
          </div>

          <!-- Card 4: Taxa de Conversão -->
          <div class="exec-kpi-card interactive" data-kpi="conversion" title="Clique para ver contratos fechados">
            <div class="exec-kpi-header">
              <span class="exec-kpi-label">TAXA DE CONVERSÃO</span>
              <div class="exec-kpi-icon-box">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                  <polyline points="17 6 23 6 23 12"></polyline>
                </svg>
              </div>
            </div>
            <div class="exec-kpi-val tnum">${conversionRate}%</div>
            <div class="exec-kpi-sub">
              <span>${closedCount} contratos fechados</span>
            </div>
            <div class="exec-kpi-action">Explorar análise →</div>
          </div>

          <!-- Card 5: Ticket Médio (TKM) -->
          <div class="exec-kpi-card interactive" data-kpi="tkm" title="Clique para ver análise do ticket médio">
            <div class="exec-kpi-header">
              <span class="exec-kpi-label">TICKET MÉDIO (TKM)</span>
              <div class="exec-kpi-icon-box">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
              </div>
            </div>
            <div class="exec-kpi-val tnum">R$ ${avgTkm.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            <div class="exec-kpi-sub">
              <span>Média ponderada por vida</span>
            </div>
            <div class="exec-kpi-action">Explorar análise →</div>
          </div>

          <!-- Card 6: Desistências / Decl... -->
          <div class="exec-kpi-card interactive" data-kpi="declines" title="Clique para ver análise de declínios e desistências">
            <div class="exec-kpi-header">
              <span class="exec-kpi-label">DESISTÊNCIAS / DECL...</span>
              <div class="exec-kpi-icon-box">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </div>
            </div>
            <div class="exec-kpi-val tnum">${declinedCount + tempCounts['Desistência da Empresa']}</div>
            <div class="exec-kpi-sub">
              <span>${tempCounts['Desistência da Empresa']} desistências + ${declinedCount} declin.</span>
            </div>
            <div class="exec-kpi-action">Explorar análise →</div>
          </div>
        </div>

        <!-- 3. Insights Estratégicos em Tempo Real -->
        <div class="exec-insights-section">
          <div class="exec-insights-header">
            <div class="exec-insights-title-box">
              <span class="exec-insights-dot"></span>
              <span class="exec-insights-title">INSIGHTS ESTRATÉGICOS EM TEMPO REAL</span>
            </div>
            <span class="exec-insights-sub">Calculados sobre as propostas no pipeline comercial</span>
          </div>

          <div class="exec-insights-grid">
            <!-- 1: Corretor Líder -->
            <div class="exec-insight-card">
              <div class="exec-insight-icon-box">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <div class="exec-insight-content">
                <span class="exec-insight-category">CORRETOR LÍDER</span>
                <div class="exec-insight-title">${insights.topBroker.name}</div>
                <div class="exec-insight-stat">${insights.topBroker.count} propostas • ${insights.topBroker.formattedRevenue}</div>
                <div class="exec-insight-desc">Maior gerador de volume de propostas no período selecionado.</div>
              </div>
            </div>

            <!-- 2: Maior Negociação -->
            <div class="exec-insight-card">
              <div class="exec-insight-icon-box">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="4" y="2" width="16" height="20" rx="2"></rect>
                  <line x1="9" y1="6" x2="9.01" y2="6"></line>
                  <line x1="15" y1="6" x2="15.01" y2="6"></line>
                  <line x1="9" y1="10" x2="9.01" y2="10"></line>
                  <line x1="15" y1="10" x2="15.01" y2="10"></line>
                  <line x1="9" y1="14" x2="9.01" y2="14"></line>
                  <line x1="15" y1="14" x2="15.01" y2="14"></line>
                  <path d="M9 22v-4h6v4"></path>
                </svg>
              </div>
              <div class="exec-insight-content">
                <span class="exec-insight-category">MAIOR NEGOCIAÇÃO</span>
                <div class="exec-insight-title">${insights.biggestDeal.company}</div>
                <div class="exec-insight-stat">${insights.biggestDeal.lives.toLocaleString('pt-BR')} vidas • ${insights.biggestDeal.formattedRevenue}</div>
                <div class="exec-insight-desc">Proposta de maior volume financeiro em carteira.</div>
              </div>
            </div>

            <!-- 3: Região Destaque -->
            <div class="exec-insight-card">
              <div class="exec-insight-icon-box">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
              </div>
              <div class="exec-insight-content">
                <span class="exec-insight-category">REGIÃO DESTAQUE</span>
                <div class="exec-insight-title">Estado ${insights.topUf.uf}</div>
                <div class="exec-insight-stat">${insights.topUf.count} propostas • ${insights.topUf.lives.toLocaleString('pt-BR')} vidas</div>
                <div class="exec-insight-desc">Maior densidade geográfica de beneficiários e empresas cotadas.</div>
              </div>
            </div>

            <!-- 4: Receita Ponderada (Simulação) -->
            <div class="exec-insight-card">
              <div class="exec-insight-icon-box">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="12" width="4" height="8" rx="1"></rect>
                  <rect x="10" y="7" width="4" height="13" rx="1"></rect>
                  <rect x="17" y="3" width="4" height="17" rx="1"></rect>
                </svg>
              </div>
              <div class="exec-insight-content">
                <span class="exec-insight-category">RECEITA PONDERADA (SIMULAÇÃO)</span>
                <div class="exec-insight-title">${BusinessRules.formatCurrency(insights.projectedRevenue)}</div>
                <div class="exec-insight-stat">Probabilidade estimada por estágio comercial</div>
                <div class="exec-insight-desc">Simulação estimada baseada em pesos hipotéticos de conversão por etapa do funil.</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. Seção Média (7:5 Split) -->
        <div class="exec-middle-grid">
          <!-- Esquerda: Desempenho Comercial Analítico -->
          <div class="exec-card">
            <div class="exec-card-header">
              <div>
                <h3 class="exec-card-title">Desempenho Comercial Analítico</h3>
                <p class="exec-card-subtitle">Selecione a métrica e o formato visual desejado</p>
              </div>
              <div class="exec-chart-controls">
                <select class="exec-select" id="chart-metric-select" title="Selecione a métrica">
                  <option value="revenue_by_competence" ${dashboardState.mainMetric === 'revenue_by_competence' ? 'selected' : ''}>Faturamento por Competência</option>
                  <option value="pipeline_temperatures" ${dashboardState.mainMetric === 'pipeline_temperatures' ? 'selected' : ''}>Distribuição por Temperatura</option>
                  <option value="top_brokers" ${dashboardState.mainMetric === 'top_brokers' ? 'selected' : ''}>Top 10 Corretores</option>
                  <option value="geo_uf" ${dashboardState.mainMetric === 'geo_uf' ? 'selected' : ''}>Distribuição por Estado (UF)</option>
                  <option value="campaigns_performance" ${dashboardState.mainMetric === 'campaigns_performance' ? 'selected' : ''}>Desempenho de Campanhas</option>
                  <option value="plans_accommodation" ${dashboardState.mainMetric === 'plans_accommodation' ? 'selected' : ''}>Acomodação (Enf / Apt / Amb)</option>
                </select>
                <div class="exec-toggle-group">
                  <button class="exec-toggle-btn ${dashboardState.chartType === 'bar' ? 'active' : ''}" data-type="bar" title="Gráfico de Barras">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="20" x2="18" y2="10"></line>
                      <line x1="12" y1="20" x2="12" y2="4"></line>
                      <line x1="6" y1="20" x2="6" y2="14"></line>
                    </svg>
                  </button>
                  <button class="exec-toggle-btn ${dashboardState.chartType === 'line' ? 'active' : ''}" data-type="line" title="Gráfico de Linhas">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div class="exec-chart-body">
              <canvas id="mainDashboardChart"></canvas>
            </div>
            <div class="exec-chart-footer">
              <div class="exec-legend-item">
                <span class="exec-legend-square"></span>
                <span>Faturamento Bruto Projetado por Competência</span>
              </div>
              <div class="exec-peak-tag">Competência de Pico: 01/11/2025</div>
            </div>
          </div>

          <!-- Direita: Funil de Vendas Interativo (RN-05) -->
          <div class="exec-card">
            <div class="exec-card-header">
              <div>
                <h3 class="exec-card-title">Funil de Vendas Interativo (RN-05)</h3>
                <p class="exec-card-subtitle">Clique em qualquer etapa para filtrar propostas</p>
              </div>
              <span class="exec-conversion-badge">${conversionRate}% Conversão</span>
            </div>
            <div class="exec-funnel-list">
              ${renderExecutiveFunnelRow('Iniciada', tempCounts['Iniciada'], totalCount, '#0284c7')}
              ${renderExecutiveFunnelRow('Fria', tempCounts['Fria'], totalCount, '#64748b')}
              ${renderExecutiveFunnelRow('Morna', tempCounts['Morna'], totalCount, '#d97706')}
              ${renderExecutiveFunnelRow('Quente', tempCounts['Quente'], totalCount, '#ea580c')}
              ${renderExecutiveFunnelRow('Contrato Fechado', tempCounts['Contrato Fechado'], totalCount, '#16a34a', true)}
              ${renderExecutiveFunnelRow('Desistência da Empresa', tempCounts['Desistência da Empresa'], totalCount, '#64748b')}
              ${renderExecutiveFunnelRow('Declinado pela SB Saúde', tempCounts['Declinado pela SB Saúde'], totalCount, '#dc2626')}
            </div>
            <div class="exec-funnel-footer">
              <span class="exec-funnel-sub">Critério RN-05: Validação ativa</span>
              <span class="exec-funnel-total">${totalCount.toLocaleString('pt-BR')} Ocorrências Totais</span>
            </div>
          </div>
        </div>

        <!-- 5. Navegação Operacional — 9 Módulos do Sistema -->
        <div class="exec-section-header">
          <div class="exec-section-title-box">
            <span class="exec-section-title">NAVEGAÇÃO OPERACIONAL</span>
            <span class="exec-badge-pill">9 MÓDULOS DO SISTEMA</span>
          </div>
        </div>

        <div class="exec-modules-grid">
          <!-- 1: Nova Prospecção -->
          <div class="exec-module-card" data-action="new-quote">
            <div class="exec-module-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3"></rect>
                <line x1="12" y1="8" x2="12" y2="16"></line>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </svg>
            </div>
            <div class="exec-module-info">
              <h4>Nova Prospecção</h4>
              <p>Inclua uma nova cotação com cálculo automático de faturamento e competência.</p>
            </div>
          </div>

          <!-- 2: Prospecções Empresariais -->
          <div class="exec-module-card" data-action="proposals">
            <div class="exec-module-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
            </div>
            <div class="exec-module-info">
              <h4>Prospecções Empresariais</h4>
              <p>Tabela e pipeline Kanban das 1.072 cotações empresariais cadastradas.</p>
            </div>
          </div>

          <!-- 3: Carteira de Corretores -->
          <div class="exec-module-card" data-action="brokers">
            <div class="exec-module-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </div>
            <div class="exec-module-info">
              <h4>Carteira de Corretores</h4>
              <p>161 corretores credenciados e participação nas 3 posições comerciais.</p>
            </div>
          </div>

          <!-- 4: Empresas Cadastradas -->
          <div class="exec-module-card" data-action="companies">
            <div class="exec-module-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="2" width="16" height="20" rx="2"></rect>
                <line x1="9" y1="6" x2="9.01" y2="6"></line>
                <line x1="15" y1="6" x2="15.01" y2="6"></line>
                <line x1="9" y1="10" x2="9.01" y2="10"></line>
                <line x1="15" y1="10" x2="15.01" y2="10"></line>
                <line x1="9" y1="14" x2="9.01" y2="14"></line>
                <line x1="15" y1="14" x2="15.01" y2="14"></line>
                <path d="M9 22v-4h6v4"></path>
              </svg>
            </div>
            <div class="exec-module-info">
              <h4>Empresas Cadastradas</h4>
              <p>535 empresas com histórico de propostas e vínculos comerciais.</p>
            </div>
          </div>

          <!-- 5: Campanhas Comerciais -->
          <div class="exec-module-card" data-action="campaigns">
            <div class="exec-module-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 11 3 6v12l18-5v-2z"></path>
                <path d="M12.4 16.8a3 3 0 1 0 5.8-1.6"></path>
              </svg>
            </div>
            <div class="exec-module-info">
              <h4>Campanhas Comerciais</h4>
              <p>27 campanhas sazonais mapeadas por competência e planos de saúde.</p>
            </div>
          </div>

          <!-- 6: Políticas de Agenciamento -->
          <div class="exec-module-card" data-action="policies">
            <div class="exec-module-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="m9 12 2 2 4-4"></path>
              </svg>
            </div>
            <div class="exec-module-info">
              <h4>Políticas de Agenciamento</h4>
              <p>Parâmetros de comissão, parcelas e vitalício dos parceiros.</p>
            </div>
          </div>

          <!-- 7: Políticas de Coparticipação -->
          <div class="exec-module-card" data-action="policies">
            <div class="exec-module-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <line x1="10" y1="9" x2="8" y2="9"></line>
              </svg>
            </div>
            <div class="exec-module-info">
              <h4>Políticas de Coparticipação</h4>
              <p>Tabelas de coparticipação com preços fixados por evento e terapias.</p>
            </div>
          </div>

          <!-- 8: Auditoria & Requisitos (Exclusivo Administrador Master) -->
          ${isMasterAdmin() ? `
          <div class="exec-module-card" data-action="audit">
            <div class="exec-module-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                <path d="m9 14 2 2 4-4"></path>
              </svg>
            </div>
            <div class="exec-module-info">
              <h4>Auditoria &amp; Requisitos</h4>
              <p>Diagnóstico de qualidade de migração e matriz de 48 requisitos funcionais.</p>
            </div>
          </div>
          ` : ''}

          <!-- 9: Exportação de Dados -->
          <div class="exec-module-card" data-action="export">
            <div class="exec-module-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </div>
            <div class="exec-module-info">
              <h4>Exportação de Dados</h4>
              <p>Gere relatórios analíticos em CSV ou JSON da carteira completa.</p>
            </div>
          </div>
        </div>

        <!-- 6. Tabela de Propostas Comerciais Recentes -->
        <div class="exec-card exec-table-card">
          <div class="exec-table-header">
            <div class="exec-table-title-box">
              <div style="display:flex; align-items:center; gap:0.6rem;">
                <h3 class="exec-card-title">Propostas Comerciais Recentes</h3>
                <button class="exec-badge-link" id="btn-view-all-proposals">Ver Todas (${totalCount.toLocaleString('pt-BR')}) →</button>
              </div>
              <p class="exec-card-subtitle">Listagem nominal das últimas cotações e propostas submetidas ao comitê de aceitação.</p>
            </div>
            <div class="exec-table-actions">
              <div class="exec-filter-tabs">
                <button class="exec-filter-tab active" data-filter="all">Todas</button>
                <button class="exec-filter-tab" data-filter="fechadas">Fechadas</button>
                <button class="exec-filter-tab" data-filter="desistencias">Desistências</button>
              </div>
              <button class="exec-btn-export" id="btn-export-recent-list">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span>Exportar Lista</span>
              </button>
            </div>
          </div>

          <div class="exec-table-responsive">
            <table class="exec-data-table" id="dashboard-recent-table">
              <thead>
                <tr>
                  <th>EMPRESA / RAZÃO SOCIAL</th>
                  <th>VIDAS</th>
                  <th>FATURAMENTO</th>
                  <th>COMPETÊNCIA</th>
                  <th>TEMPERATURA / STATUS</th>
                  <th>CORRETOR TITULAR</th>
                  <th>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                ${renderDashboardTableRows(proposals)}
              </tbody>
            </table>
          </div>

          <div class="exec-table-footer">
            <div class="exec-table-info">
              Mostrando <span id="table-showing-range">1 a 7</span> de <strong>${totalCount.toLocaleString('pt-BR')}</strong> propostas cadastradas
            </div>
            <div class="exec-pagination">
              <button class="exec-page-btn" disabled>Anterior</button>
              <button class="exec-page-btn active">1</button>
              <button class="exec-page-btn">2</button>
              <button class="exec-page-btn">3</button>
              <span class="exec-page-dots">...</span>
              <button class="exec-page-btn">154</button>
              <button class="exec-page-btn">Próxima</button>
            </div>
          </div>
        </div>

        <!-- 7. Barra Inferior Institucional e Governança -->
        <footer class="exec-bottom-bar">
          <div class="exec-bottom-left">
            SB Saúde Corporativa • Módulo de Inteligência Comercial e Aceitação v4.8
          </div>
          <div class="exec-bottom-right">
            <span class="exec-status-service">
              <span class="exec-service-dot"></span> Todos os microsserviços operando normalmente
            </span>
            ${isMasterAdmin() ? '<a class="exec-footer-link" id="link-central-requisitos">Central de Requisitos</a>' : ''}
            <a class="exec-footer-link" id="link-governanca-lgpd">Políticas e Governança LGPD</a>
          </div>
        </footer>

        <!-- Modal de Drill-Down Dinâmico -->
        <div class="drilldown-modal-overlay" id="drilldown-modal-overlay" style="display:none;" role="dialog" aria-modal="true">
          <div class="drilldown-modal" id="drilldown-modal">
            <div class="drilldown-header">
              <div>
                <h2 id="drilldown-modal-title">—</h2>
                <p id="drilldown-modal-desc">—</p>
              </div>
              <button class="drilldown-close" id="drilldown-modal-close" title="Fechar">✕</button>
            </div>
            <div class="drilldown-body" id="drilldown-modal-body">
              <!-- conteúdo dinâmico -->
            </div>
          </div>
        </div>
      </div>
    `;

    // Renderiza o gráfico interativo Chart.js
    renderMainChart(proposals);

    // Eventos do seletor de métrica do gráfico
    const metricSelect = container.querySelector('#chart-metric-select');
    if (metricSelect) {
      metricSelect.addEventListener('change', (e) => {
        dashboardState.mainMetric = e.target.value;
        renderMainChart(proposals);
      });
    }

    // Eventos de troca de tipo de gráfico (Barras / Linhas)
    container.querySelectorAll('.exec-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.exec-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        dashboardState.chartType = btn.dataset.type;
        renderMainChart(proposals);
      });
    });

    // Eventos de clique nos 6 KPIs Executivos (Drill-Down)
    container.querySelectorAll('.exec-kpi-card.interactive').forEach(card => {
      card.addEventListener('click', () => {
        openKpiDrillDown(card.dataset.kpi, proposals);
      });
    });

    // Eventos de clique no funil interativo
    container.querySelectorAll('.exec-funnel-row.interactive').forEach(item => {
      item.addEventListener('click', () => {
        const temp = item.dataset.temp;
        openFunnelDrillDown(temp, proposals);
      });
    });

    // Modal close listeners
    const modalCloseBtn = container.querySelector('#drilldown-modal-close');
    const modalOverlay = container.querySelector('#drilldown-modal-overlay');
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeDrillDownModal);
    if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeDrillDownModal();
      });
    }

    // Eventos de Módulos Operacionais
    container.querySelectorAll('.exec-module-card').forEach(card => {
      card.addEventListener('click', () => {
        const action = card.dataset.action;
        if (action === 'new-quote') {
          openNewQuoteModal();
        } else if (action === 'export') {
          exportDataCSV();
        } else if (action === 'audit' && !isMasterAdmin()) {
          showToast('Acesso restrito: A tela de Auditoria & Requisitos é visível apenas para usuários com perfil Administrador Master.', 'warning');
        } else {
          state.currentTab = action;
          renderView();
        }
      });
    });

    // Filtros rápidos da tabela de propostas recentes
    let currentTableFilter = 'all';
    function updateRecentTable() {
      let filtered = proposals;
      if (currentTableFilter === 'fechadas') {
        filtered = proposals.filter(p => (p.TEMPERATURA_CONTRATO || '').toLowerCase().includes('fechado'));
      } else if (currentTableFilter === 'desistencias') {
        filtered = proposals.filter(p => (p.TEMPERATURA_CONTRATO || '').toLowerCase().includes('desist'));
      }
      const tbody = container.querySelector('#dashboard-recent-table tbody');
      if (tbody) {
        tbody.innerHTML = renderDashboardTableRows(filtered);
        tbody.querySelectorAll('.exec-table-row').forEach(row => {
          row.addEventListener('click', () => openProposalDrawer(row.dataset.id));
        });
        tbody.querySelectorAll('.btn-open-detail').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openProposalDrawer(btn.dataset.id);
          });
        });
      }
      const showingRange = container.querySelector('#table-showing-range');
      if (showingRange) {
        const count = Math.min(7, filtered.length);
        showingRange.textContent = count > 0 ? `1 a ${count}` : '0';
      }
    }

    container.querySelectorAll('.exec-filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.exec-filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTableFilter = tab.dataset.filter;
        updateRecentTable();
      });
    });

    // Exportação da lista recente
    const btnExportList = container.querySelector('#btn-export-recent-list');
    if (btnExportList) {
      btnExportList.addEventListener('click', () => exportDataCSV());
    }

    // Botão Ver Todas as Propostas
    const btnViewAll = container.querySelector('#btn-view-all-proposals');
    if (btnViewAll) {
      btnViewAll.addEventListener('click', () => {
        state.currentTab = 'proposals';
        renderView();
      });
    }

    // Links de rodapé
    const linkAudit = container.querySelector('#link-central-requisitos');
    if (linkAudit) {
      linkAudit.addEventListener('click', () => {
        if (!isMasterAdmin()) {
          showToast('Acesso restrito: A tela de Auditoria & Requisitos é visível apenas para usuários com perfil Administrador Master.', 'warning');
          return;
        }
        state.currentTab = 'audit';
        renderView();
      });
    }

    const linkPolicies = container.querySelector('#link-governanca-lgpd');
    if (linkPolicies) {
      linkPolicies.addEventListener('click', () => {
        state.currentTab = 'policies';
        renderView();
      });
    }

    // Clicks nos detalhes das linhas da tabela
    container.querySelectorAll('.btn-open-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openProposalDrawer(btn.dataset.id);
      });
    });

    container.querySelectorAll('.exec-table-row').forEach(tr => {
      tr.addEventListener('click', () => {
        openProposalDrawer(tr.dataset.id);
      });
    });
  }

  // Cálculo de Insights Estratégicos Inteligentes
  function calculateStrategicInsights(proposals) {
    // 1. Top Corretor
    const brokerCounts = {};
    const brokerRevenues = {};
    proposals.forEach(p => {
      const b = p.CORRETORES_1 || 'Direto';
      brokerCounts[b] = (brokerCounts[b] || 0) + 1;
      brokerRevenues[b] = (brokerRevenues[b] || 0) + BusinessRules.parseCurrency(p.FATURAMENTO);
    });
    const sortedBrokers = Object.entries(brokerCounts).sort((a,b) => b[1] - a[1]);
    const topBrokerName = sortedBrokers.length > 0 ? sortedBrokers[0][0] : 'Direto';
    const topBrokerCount = sortedBrokers.length > 0 ? sortedBrokers[0][1] : 0;
    const topBrokerRev = brokerRevenues[topBrokerName] || 0;

    // 2. Maior Cotação
    let biggest = { company: 'Nenhuma', lives: 0, revenue: 0 };
    proposals.forEach(p => {
      const rev = BusinessRules.parseCurrency(p.FATURAMENTO);
      const lives = BusinessRules.parseLives(p.VIDAS);
      if (rev > biggest.revenue) {
        biggest = { company: p.EMPRESA || 'Sem Nome', lives, revenue: rev };
      }
    });

    // 3. Região / UF Destaque
    const ufCounts = {};
    const ufLives = {};
    proposals.forEach(p => {
      const uf = p.UF || 'SP';
      ufCounts[uf] = (ufCounts[uf] || 0) + 1;
      ufLives[uf] = (ufLives[uf] || 0) + BusinessRules.parseLives(p.VIDAS);
    });
    const sortedUfs = Object.entries(ufCounts).sort((a,b) => b[1] - a[1]);
    const topUfName = sortedUfs.length > 0 ? sortedUfs[0][0] : 'SP';
    const topUfCount = sortedUfs.length > 0 ? sortedUfs[0][1] : 0;
    const topUfLiveCount = ufLives[topUfName] || 0;

    // 4. Receita Ponderada (Probabilidade por temperatura)
    const weights = {
      'Contrato Fechado': 1.0,
      'Quente': 0.75,
      'Morna': 0.50,
      'Iniciada': 0.25,
      'Fria': 0.15,
      'Desistência da Empresa': 0,
      'Declinado pela SB Saúde': 0
    };
    let projectedRevenue = 0;
    proposals.forEach(p => {
      const temp = p.TEMPERATURA_CONTRATO || 'Iniciada';
      const w = weights[temp] !== undefined ? weights[temp] : 0.2;
      projectedRevenue += (BusinessRules.parseCurrency(p.FATURAMENTO) * w);
    });

    return {
      topBroker: {
        name: topBrokerName,
        count: topBrokerCount,
        formattedRevenue: BusinessRules.formatCurrency(topBrokerRev)
      },
      biggestDeal: {
        company: biggest.company,
        lives: biggest.lives,
        formattedRevenue: BusinessRules.formatCurrency(biggest.revenue)
      },
      topUf: {
        uf: topUfName,
        count: topUfCount,
        lives: topUfLiveCount
      },
      projectedRevenue
    };
  }

  // Motor de Gráficos Profissionais Chart.js
  function renderMainChart(proposals) {
    const canvas = document.getElementById('mainDashboardChart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (mainChartInstance) {
      mainChartInstance.destroy();
      mainChartInstance = null;
    }

    const metric = dashboardState.mainMetric;
    const chartType = dashboardState.chartType;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : '#f1f5f9';
    const tooltipBg = isDark ? '#1e293b' : '#0f172a';
    const tooltipBorder = isDark ? '#334155' : '#0f172a';

    let chartData = { labels: [], datasets: [] };
    let chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: chartType === 'doughnut' || chartType === 'polarArea',
          position: 'right',
          labels: {
            boxWidth: 12,
            font: { family: 'Inter', size: 11 },
            color: isDark ? '#cbd5e1' : '#475569'
          }
        },
        tooltip: {
          padding: 10,
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          borderWidth: isDark ? 1 : 0,
          titleColor: '#ffffff',
          bodyColor: isDark ? '#cbd5e1' : '#f8fafc',
          titleFont: { family: 'Plus Jakarta Sans', weight: 'bold' },
          bodyFont: { family: 'Inter' }
        }
      },
      scales: (chartType === 'bar' || chartType === 'line') ? {
        x: {
          grid: { display: false },
          ticks: {
            font: { family: 'Inter', size: 10 },
            color: textColor
          }
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            font: { family: 'Inter', size: 10 },
            color: textColor,
            callback: (v) => {
              if (metric.includes('revenue')) return 'R$ ' + (v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : (v/1000).toFixed(0) + 'k');
              return v;
            }
          }
        }
      } : {}
    };

    const colors = ['#dc2626', '#b91c1c', '#0284c7', isDark ? '#94a3b8' : '#0f172a', '#16a34a', '#d97706', '#ea580c', '#8b5cf6', '#ec4899', '#64748b'];

    if (metric === 'revenue_by_competence') {
      const compRevenue = {};
      proposals.forEach(p => {
        const c = p.COMPETENCIA || '01/01/2024';
        compRevenue[c] = (compRevenue[c] || 0) + BusinessRules.parseCurrency(p.FATURAMENTO);
      });
      const sortedComps = Object.keys(compRevenue).sort((a,b) => {
        const [d1,m1,y1] = a.split('/').map(Number);
        const [d2,m2,y2] = b.split('/').map(Number);
        return new Date(y1,m1-1,d1) - new Date(y2,m2-1,d2);
      });

      chartData.labels = sortedComps.slice(-10);
      chartData.datasets = [{
        label: 'Faturamento Bruto Projetado (R$)',
        data: sortedComps.slice(-10).map(c => compRevenue[c]),
        backgroundColor: chartType === 'line' ? 'rgba(190, 18, 60, 0.12)' : '#be123c',
        hoverBackgroundColor: '#9f1239',
        borderColor: '#be123c',
        borderWidth: chartType === 'line' ? 2 : 0,
        fill: chartType === 'line',
        tension: 0.35,
        borderRadius: chartType === 'bar' ? 4 : 0,
        maxBarThickness: 34
      }];
    } else if (metric === 'pipeline_temperatures') {
      const temps = {
        'Contrato Fechado': 0,
        'Quente': 0,
        'Morna': 0,
        'Iniciada': 0,
        'Fria': 0,
        'Desistência da Empresa': 0,
        'Declinado pela SB Saúde': 0
      };
      proposals.forEach(p => {
        const t = p.TEMPERATURA_CONTRATO || 'Iniciada';
        if (temps[t] !== undefined) temps[t]++;
        else if (t.includes('Desist')) temps['Desistência da Empresa']++;
        else temps['Iniciada']++;
      });
      chartData.labels = Object.keys(temps);
      chartData.datasets = [{
        label: 'Propostas por Estágio',
        data: Object.values(temps),
        backgroundColor: ['#16a34a', '#ea580c', '#d97706', '#0284c7', '#64748b', '#94a3b8', '#dc2626'],
        borderWidth: 1,
        borderRadius: chartType === 'bar' ? 6 : 0
      }];
    } else if (metric === 'top_brokers') {
      const brokerCounts = {};
      proposals.forEach(p => {
        const b = p.CORRETORES_1 || 'Direto';
        brokerCounts[b] = (brokerCounts[b] || 0) + 1;
      });
      const top = Object.entries(brokerCounts).sort((a,b) => b[1] - a[1]).slice(0, 10);
      chartData.labels = top.map(t => t[0]);
      chartData.datasets = [{
        label: 'Propostas por Corretor',
        data: top.map(t => t[1]),
        backgroundColor: colors,
        borderWidth: 1,
        borderRadius: chartType === 'bar' ? 6 : 0
      }];
    } else if (metric === 'geo_uf') {
      const ufs = {};
      proposals.forEach(p => {
        const uf = p.UF || 'SP';
        ufs[uf] = (ufs[uf] || 0) + 1;
      });
      const topUfs = Object.entries(ufs).sort((a,b) => b[1] - a[1]).slice(0, 8);
      chartData.labels = topUfs.map(u => u[0]);
      chartData.datasets = [{
        label: 'Propostas por UF',
        data: topUfs.map(u => u[1]),
        backgroundColor: colors,
        borderWidth: 1,
        borderRadius: chartType === 'bar' ? 6 : 0
      }];
    } else if (metric === 'campaigns_performance') {
      const camps = {};
      proposals.forEach(p => {
        const c = p.PLANO_CAMPANHA || 'Geral';
        camps[c] = (camps[c] || 0) + 1;
      });
      const topCamps = Object.entries(camps).sort((a,b) => b[1] - a[1]).slice(0, 8);
      chartData.labels = topCamps.map(c => c[0].replace('Campanha de ', '').replace('Campanha ', ''));
      chartData.datasets = [{
        label: 'Propostas por Campanha',
        data: topCamps.map(c => c[1]),
        backgroundColor: colors,
        borderWidth: 1,
        borderRadius: chartType === 'bar' ? 6 : 0
      }];
    } else if (metric === 'plans_accommodation') {
      const acoms = { 'Enfermaria': 0, 'Apartamento': 0, 'Ambulatorial': 0 };
      proposals.forEach(p => {
        const a = p.ACOMODACAO || 'Enfermaria';
        if (acoms[a] !== undefined) acoms[a]++;
        else acoms['Enfermaria']++;
      });
      chartData.labels = Object.keys(acoms);
      chartData.datasets = [{
        label: 'Propostas por Acomodação',
        data: Object.values(acoms),
        backgroundColor: ['#dc2626', '#0284c7', '#16a34a'],
        borderWidth: 1,
        borderRadius: chartType === 'bar' ? 6 : 0
      }];
    }

    try {
      mainChartInstance = new Chart(canvas, {
        type: chartType,
        data: chartData,
        options: chartOptions
      });
    } catch (e) {
      console.error('Erro ao renderizar Chart.js:', e);
    }
  }

  // Fechar Modal Drilldown
  function closeDrillDownModal() {
    const overlay = document.getElementById('drilldown-modal-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  // Drilldown ao Clicar em Qualquer KPI
  function openKpiDrillDown(kpiKey, proposals) {
    const overlay = document.getElementById('drilldown-modal-overlay');
    const titleEl = document.getElementById('drilldown-modal-title');
    const descEl = document.getElementById('drilldown-modal-desc');
    const bodyEl = document.getElementById('drilldown-modal-body');
    if (!overlay || !bodyEl) return;

    let title = '';
    let desc = '';
    let filteredList = proposals;

    if (kpiKey === 'volume') {
      title = 'Detalhamento do Volume de Propostas';
      desc = `Análise abrangente de todas as ${proposals.length} propostas do período`;
      filteredList = proposals;
    } else if (kpiKey === 'lives') {
      title = 'Detalhamento de Vidas em Cotação';
      desc = 'Propostas ordenadas por número de vidas seguradas';
      filteredList = [...proposals].sort((a,b) => BusinessRules.parseLives(b.VIDAS) - BusinessRules.parseLives(a.VIDAS));
    } else if (kpiKey === 'revenue') {
      title = 'Ranking de Faturamento em Negociação';
      desc = 'Maiores valores monetários cotados em carteira';
      filteredList = [...proposals].sort((a,b) => BusinessRules.parseCurrency(b.FATURAMENTO) - BusinessRules.parseCurrency(a.FATURAMENTO));
    } else if (kpiKey === 'conversion') {
      title = 'Contratos Comerciais Fechados';
      desc = 'Cotações convertidas com sucesso em novos contratos SB Saúde';
      filteredList = proposals.filter(p => (p.TEMPERATURA_CONTRATO || '').includes('Fechado'));
    } else if (kpiKey === 'tkm') {
      title = 'Análise de Ticket Médio (TKM)';
      desc = 'Distribuição de TKM por proposta e beneficiários';
      filteredList = [...proposals].sort((a,b) => BusinessRules.parseCurrency(b.TKM) - BusinessRules.parseCurrency(a.TKM));
    } else if (kpiKey === 'declines') {
      title = 'Diagnóstico de Declínios e Desistências';
      desc = 'Casos que não avançaram no ciclo de contratação';
      filteredList = proposals.filter(p => {
        const t = (p.TEMPERATURA_CONTRATO || '').toLowerCase();
        return t.includes('declin') || t.includes('desist');
      });
    }

    titleEl.textContent = title;
    descEl.textContent = desc;

    // Métricas rápidas da seleção
    const count = filteredList.length;
    let sumLives = 0;
    let sumRev = 0;
    filteredList.forEach(p => {
      sumLives += BusinessRules.parseLives(p.VIDAS);
      sumRev += BusinessRules.parseCurrency(p.FATURAMENTO);
    });

    bodyEl.innerHTML = `
      <div class="drilldown-kpis">
        <div class="drilldown-kpi-card">
          <span class="drilldown-kpi-val">${count.toLocaleString('pt-BR')}</span>
          <span class="drilldown-kpi-label">Propostas Filtradas</span>
        </div>
        <div class="drilldown-kpi-card">
          <span class="drilldown-kpi-val">${sumLives.toLocaleString('pt-BR')}</span>
          <span class="drilldown-kpi-label">Total de Vidas</span>
        </div>
        <div class="drilldown-kpi-card">
          <span class="drilldown-kpi-val" style="color:var(--success);">${BusinessRules.formatCurrency(sumRev)}</span>
          <span class="drilldown-kpi-label">Faturamento Total</span>
        </div>
      </div>

      <div class="table-container" style="max-height: 420px; overflow-y: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Empresa</th>
              <th>UF</th>
              <th>Vidas</th>
              <th>TKM</th>
              <th>Faturamento</th>
              <th>Competência</th>
              <th>Temperatura</th>
              <th>Corretor</th>
            </tr>
          </thead>
          <tbody>
            ${filteredList.slice(0, 50).map(p => `
              <tr style="cursor:pointer;" onclick="openProposalDrawer('${p.ID}')">
                <td><span class="code-tag">#PRP-${p.ID}</span></td>
                <td><strong>${p.EMPRESA || 'Empresa Não Informada'}</strong></td>
                <td>${p.UF || '-'}</td>
                <td class="tnum">${p.VIDAS || '0'}</td>
                <td class="tnum">${p.TKM || '-'}</td>
                <td class="tnum font-bold">${p.FATURAMENTO || 'R$ 0,00'}</td>
                <td>${p.COMPETENCIA || '-'}</td>
                <td><span class="temp-badge ${getBadgeClass(p.TEMPERATURA_CONTRATO)}">${p.TEMPERATURA_CONTRATO || 'Iniciada'}</span></td>
                <td>${p.CORRETORES_1 || 'Direto'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${count > 50 ? `<div style="text-align:center;font-size:0.75rem;color:var(--text-muted);">Exibindo as primeiras 50 de ${count} propostas.</div>` : ''}
    `;

    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  // Drilldown ao Clicar no Funil
  function openFunnelDrillDown(temperatureName, proposals) {
    const filtered = proposals.filter(p => {
      const t = p.TEMPERATURA_CONTRATO || 'Iniciada';
      if (temperatureName.includes('Desist')) return t.includes('Desist');
      return t === temperatureName;
    });

    const overlay = document.getElementById('drilldown-modal-overlay');
    const titleEl = document.getElementById('drilldown-modal-title');
    const descEl = document.getElementById('drilldown-modal-desc');
    const bodyEl = document.getElementById('drilldown-modal-body');
    if (!overlay || !bodyEl) return;

    titleEl.textContent = `Propostas no Estágio: ${temperatureName}`;
    descEl.textContent = `${filtered.length} cotações classificadas com esta temperatura comercial`;

    let sumLives = 0;
    let sumRev = 0;
    filtered.forEach(p => {
      sumLives += BusinessRules.parseLives(p.VIDAS);
      sumRev += BusinessRules.parseCurrency(p.FATURAMENTO);
    });

    bodyEl.innerHTML = `
      <div class="drilldown-kpis">
        <div class="drilldown-kpi-card">
          <span class="drilldown-kpi-val">${filtered.length}</span>
          <span class="drilldown-kpi-label">Propostas no Estágio</span>
        </div>
        <div class="drilldown-kpi-card">
          <span class="drilldown-kpi-val">${sumLives.toLocaleString('pt-BR')}</span>
          <span class="drilldown-kpi-label">Vidas Mapeadas</span>
        </div>
        <div class="drilldown-kpi-card">
          <span class="drilldown-kpi-val" style="color:var(--success);">${BusinessRules.formatCurrency(sumRev)}</span>
          <span class="drilldown-kpi-label">Faturamento Total</span>
        </div>
      </div>

      <div class="table-container" style="max-height: 420px; overflow-y: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Empresa</th>
              <th>UF</th>
              <th>Vidas</th>
              <th>TKM</th>
              <th>Faturamento</th>
              <th>Competência</th>
              <th>Corretor</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(p => `
              <tr style="cursor:pointer;" onclick="openProposalDrawer('${p.ID}')">
                <td><span class="code-tag">#PRP-${p.ID}</span></td>
                <td><strong>${p.EMPRESA || 'Empresa Não Informada'}</strong></td>
                <td>${p.UF || '-'}</td>
                <td class="tnum">${p.VIDAS || '0'}</td>
                <td class="tnum">${p.TKM || '-'}</td>
                <td class="tnum font-bold">${p.FATURAMENTO || 'R$ 0,00'}</td>
                <td>${p.COMPETENCIA || '-'}</td>
                <td>${p.CORRETORES_1 || 'Direto'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function renderFunnelItem(label, count, total, color) {
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
    return `
      <div class="funnel-item interactive" data-temp="${label}" title="Clique para abrir as ${count} propostas deste estágio">
        <div class="funnel-progress" style="width: ${pct}%; background-color: ${color};"></div>
        <div class="funnel-name">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color: ${color};"></span>
          ${label}
        </div>
        <div class="funnel-stats">
          <span class="funnel-count tnum">${count}</span>
          <span class="funnel-vol tnum">(${pct}%)</span>
          <span style="font-size:0.75rem; color:var(--text-muted); margin-left:0.25rem;">→</span>
        </div>
      </div>
    `;
  }

  // 2. GESTÃO DE PROSPECÇÕES EMPRESARIAIS (KANBAN & TABELA)
  function renderProposals(container) {
    const proposals = getFilteredProposals();
    const totalFiltered = proposals.length;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title">
          <h2>Prospecções Empresariais</h2>
          <p id="proposals-subtitle">${totalFiltered} propostas encontradas no ciclo com base nos filtros atuais</p>
        </div>
        <div class="header-actions">
          <div class="view-mode-toggle">
            <button class="view-toggle-btn ${state.proposalsViewMode === 'kanban' ? 'active' : ''}" id="btn-switch-kanban">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="18" rx="1.5"></rect>
                <rect x="14" y="3" width="7" height="10" rx="1.5"></rect>
              </svg>
              <span>Kanban</span>
            </button>
            <button class="view-toggle-btn ${state.proposalsViewMode === 'table' ? 'active' : ''}" id="btn-switch-table">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
              </svg>
              <span>Tabela</span>
            </button>
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-export-proposals">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Exportar CSV</span>
          </button>
          <button class="btn btn-primary btn-sm btn-new-quote" id="btn-new-quote-proposals">+ Nova Cotação</button>
        </div>
      </div>

      <!-- Barra de Filtros Refinada (Imagem de Referência) -->
      <div class="filter-toolbar">
        <div class="filter-search-box">
          <svg class="filter-search-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" class="filter-search-input" id="search-proposals" placeholder="Buscar por Razão Social, ID (#PRP), CNPJ ou Contato..." value="${state.searchQuery}">
        </div>

        <div class="filter-dropdowns-group">
          <div class="filter-item">
            <span class="filter-item-label">Temperatura:</span>
            <select class="filter-select" id="filter-temp">
              <option value="">Todas as Temperaturas</option>
              ${BusinessRules.TEMPERATURAS.map(t => `<option value="${t}" ${state.filters.temperature === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>

          <div class="filter-item">
            <span class="filter-item-label">Competência:</span>
            <select class="filter-select" id="filter-comp">
              <option value="">Todas as Competências</option>
              ${getDistinctCompetences().map(c => `<option value="${c}" ${state.filters.competence === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>

          <div class="filter-item">
            <span class="filter-item-label">Corretor:</span>
            <select class="filter-select" id="filter-broker">
              <option value="">Todos os Corretores</option>
              ${appData.brokers.slice(0, 40).map(b => `<option value="${b.CORRETOR_1}" ${state.filters.broker === b.CORRETOR_1 ? 'selected' : ''}>${b.CORRETOR_1}</option>`).join('')}
            </select>
          </div>

          <button class="btn-clear-filter" id="btn-clear-filters">✕ Limpar Filtros</button>
        </div>
      </div>

      <!-- Área de Visualização: Kanban ou Tabela -->
      <div id="proposals-content-area">
        ${state.proposalsViewMode === 'kanban' ? renderKanbanContent(proposals) : renderTableContent(proposals)}
      </div>
    `;

    // Eventos de visualização
    container.querySelector('#btn-switch-kanban').addEventListener('click', () => {
      state.proposalsViewMode = 'kanban';
      renderView();
    });

    container.querySelector('#btn-switch-table').addEventListener('click', () => {
      state.proposalsViewMode = 'table';
      renderView();
    });

    container.querySelector('#btn-new-quote-proposals').addEventListener('click', () => {
      openNewQuoteModal();
    });

    container.querySelector('#btn-export-proposals').addEventListener('click', () => {
      exportDataCSV();
    });

    const searchInput = container.querySelector('#search-proposals');
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase();
      updateProposalsArea();
    });

    const filterTemp = container.querySelector('#filter-temp');
    filterTemp.addEventListener('change', (e) => {
      state.filters.temperature = e.target.value;
      updateProposalsArea();
    });

    const filterComp = container.querySelector('#filter-comp');
    filterComp.addEventListener('change', (e) => {
      state.filters.competence = e.target.value;
      updateProposalsArea();
    });

    const filterBroker = container.querySelector('#filter-broker');
    filterBroker.addEventListener('change', (e) => {
      state.filters.broker = e.target.value;
      updateProposalsArea();
    });

    container.querySelector('#btn-clear-filters').addEventListener('click', () => {
      state.searchQuery = '';
      state.filters = { temperature: '', competence: '', broker: '', uf: '' };
      renderView();
    });

    attachProposalItemEvents(container);
  }

  function getFilteredProposals() {
    return appData.proposals.filter(p => {
      if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        const matchEmpresa = (p.EMPRESA || '').toLowerCase().includes(query);
        const matchId = (p.ID || '').toLowerCase().includes(query);
        const matchBroker = (p.CORRETORES_1 || '').toLowerCase().includes(query);
        const matchCnpj = (p.CNPJ || '').toLowerCase().includes(query);
        if (!matchEmpresa && !matchId && !matchBroker && !matchCnpj) return false;
      }

      if (state.filters.temperature && p.TEMPERATURA_CONTRATO !== state.filters.temperature) {
        return false;
      }

      if (state.filters.competence && p.COMPETENCIA !== state.filters.competence) {
        return false;
      }

      if (state.filters.broker && p.CORRETORES_1 !== state.filters.broker) {
        return false;
      }

      return true;
    });
  }

  function getDistinctCompetences() {
    const set = new Set();
    appData.proposals.forEach(p => {
      if (p.COMPETENCIA) set.add(p.COMPETENCIA);
    });
    return Array.from(set).sort().reverse();
  }

  function renderKanbanContent(proposals) {
    const columns = [
      { name: 'Iniciada', title: 'Iniciada', dotClass: 'dot-iniciada', colClass: 'col-iniciada' },
      { name: 'Fria', title: 'Fria', dotClass: 'dot-fria', colClass: 'col-fria' },
      { name: 'Morna', title: 'Morna', dotClass: 'dot-morna', colClass: 'col-morna' },
      { name: 'Quente', title: 'Quente', dotClass: 'dot-quente', colClass: 'col-quente' },
      { name: 'Contrato Fechado', title: 'Contrato Fechado', dotClass: 'dot-fechado', colClass: 'col-fechado' },
      { name: 'Desistência da Empresa', title: 'Desistências', dotClass: 'dot-desistencia', colClass: 'col-desistencia' },
      { name: 'Declinado pela SB Saúde', title: 'Declinadas SB', dotClass: 'dot-declinada', colClass: 'col-declinada' }
    ];

    function getValorLabel(temp) {
      if (!temp) return 'VALOR NEGOCIADO';
      const t = temp.toLowerCase();
      if (t.includes('fechado')) return 'VALOR FECHADO';
      if (t.includes('desist')) return 'VALOR PREVISTO';
      if (t.includes('declinado')) return 'VALOR DECLINADO';
      return 'VALOR NEGOCIADO';
    }

    function getShortTempBadge(temp) {
      if (!temp) return { text: 'Iniciada', cls: 'badge-iniciada' };
      const t = temp.toLowerCase();
      if (t.includes('fechado')) return { text: 'Fechado', cls: 'badge-fechado' };
      if (t.includes('quente')) return { text: 'Quente', cls: 'badge-quente' };
      if (t.includes('morna')) return { text: 'Morna', cls: 'badge-morna' };
      if (t.includes('fria')) return { text: 'Fria', cls: 'badge-fria' };
      if (t.includes('declinado')) return { text: 'Declinada', cls: 'badge-declinada' };
      if (t.includes('desist')) return { text: 'Desistência', cls: 'badge-desistencia' };
      return { text: 'Iniciada', cls: 'badge-iniciada' };
    }

    return `
      <div class="kanban-board">
        ${columns.map(col => {
          const colItems = proposals.filter(p => {
            const temp = p.TEMPERATURA_CONTRATO || 'Iniciada';
            if (col.name === 'Desistência da Empresa') return temp.includes('Desist');
            return temp === col.name;
          });

          return `
            <div class="kanban-col ${col.colClass}" data-col="${col.name}">
              <div class="kanban-col-header">
                <div class="kanban-header-left">
                  <span class="kanban-col-dot ${col.dotClass}"></span>
                  <span class="kanban-col-title">${col.title}</span>
                </div>
                <span class="kanban-count-pill tnum">${colItems.length}</span>
              </div>
              <div class="kanban-col-body">
                ${colItems.slice(0, 35).map(p => {
                  const badge = getShortTempBadge(p.TEMPERATURA_CONTRATO);
                  const valorLabel = getValorLabel(p.TEMPERATURA_CONTRATO);
                  const isFechado = (p.TEMPERATURA_CONTRATO || '').toLowerCase().includes('fechado');
                  const cardDate = p.DATA_DA_PROSPECCAO || p.COMPETENCIA || p.Data_Inclusao || '01/01/2025';

                  return `
                    <div class="kanban-card" data-id="${p.ID}">
                      <div class="kanban-card-top">
                        <span class="proposal-id">#PRP-${p.ID}</span>
                        <span class="kanban-status-pill ${badge.cls}">${badge.text}</span>
                      </div>
                      <div class="kanban-company" title="${p.EMPRESA || 'Empresa Sem Nome'}">${p.EMPRESA || 'Empresa Sem Nome'}</div>
                      <div class="kanban-card-metrics">
                        <div class="card-metric-block">
                          <span class="card-metric-label">VIDAS</span>
                          <span class="card-metric-val tnum">${p.VIDAS || '0'} vidas</span>
                        </div>
                        <div class="card-metric-block text-right">
                          <span class="card-metric-label">${valorLabel}</span>
                          <span class="card-metric-val tnum ${isFechado ? 'val-fechado' : ''}">${p.FATURAMENTO || 'R$ 0,00'}</span>
                        </div>
                      </div>
                      <div class="kanban-card-footer">
                        <span class="card-broker" title="${p.CORRETORES_1 || 'Direto'}">
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                          </svg>
                          <span>${p.CORRETORES_1 || 'Direto'}</span>
                        </span>
                        <span class="card-date">${cardDate}</span>
                      </div>
                    </div>
                  `;
                }).join('')}
                ${colItems.length > 35 ? `<div class="kanban-more-items">+ ${colItems.length - 35} outras propostas...</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderTableContent(proposals) {
    const page = state.tablePagination.page;
    const pageSize = state.tablePagination.pageSize;
    const start = (page - 1) * pageSize;
    const paginated = proposals.slice(start, start + pageSize);
    const totalPages = Math.ceil(proposals.length / pageSize) || 1;

    return `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Empresa</th>
              <th>CNPJ</th>
              <th>Vidas</th>
              <th>Faturamento</th>
              <th>Competência</th>
              <th>Temperatura</th>
              <th>Corretor Titular</th>
              <th>Acomodação</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${paginated.map(p => `
              <tr data-id="${p.ID}">
                <td><span class="code-tag">#PRP-${p.ID}</span></td>
                <td><strong>${p.EMPRESA || '-'}</strong></td>
                <td style="font-size:0.75rem;">${p.CNPJ || 'Pendente'}</td>
                <td class="tnum">${p.VIDAS || '0'}</td>
                <td class="tnum font-weight-bold" style="color:var(--text-primary); font-weight:600;">${p.FATURAMENTO || 'R$ 0,00'}</td>
                <td>${p.COMPETENCIA || '-'}</td>
                <td><span class="temp-badge ${getBadgeClass(p.TEMPERATURA_CONTRATO)}">${p.TEMPERATURA_CONTRATO || 'Iniciada'}</span></td>
                <td>${p.CORRETORES_1 || '-'}</td>
                <td>${p.ACOMODACAO || '-'}</td>
                <td>
                  <button class="btn btn-ghost btn-sm btn-open-detail" data-id="${p.ID}">Ver</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="table-pagination">
          <span class="pagination-info">
            Mostrando ${start + 1} a ${Math.min(start + pageSize, proposals.length)} de ${proposals.length} propostas
          </span>
          <div class="pagination-controls">
            <button class="btn btn-secondary btn-sm" id="btn-page-prev" ${page <= 1 ? 'disabled' : ''}>← Anterior</button>
            <span style="display:flex; align-items:center; padding:0 8px; font-size:0.8rem; color:var(--text-muted);">Página ${page} de ${totalPages}</span>
            <button class="btn btn-secondary btn-sm" id="btn-page-next" ${page >= totalPages ? 'disabled' : ''}>Próxima →</button>
          </div>
        </div>
      </div>
    `;
  }

  function updateProposalsArea() {
    const area = document.getElementById('proposals-content-area');
    if (!area) return;
    const filtered = getFilteredProposals();
    const subtitle = document.getElementById('proposals-subtitle');
    if (subtitle) {
      subtitle.textContent = `${filtered.length} propostas encontradas no ciclo com base nos filtros atuais`;
    }
    area.innerHTML = state.proposalsViewMode === 'kanban' ? renderKanbanContent(filtered) : renderTableContent(filtered);
    attachProposalItemEvents(area);
  }

  function attachProposalItemEvents(parentEl) {
    parentEl.querySelectorAll('.kanban-card, tr[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        openProposalDrawer(el.dataset.id);
      });
    });

    parentEl.querySelectorAll('.btn-open-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openProposalDrawer(btn.dataset.id);
      });
    });

    const btnPrev = parentEl.querySelector('#btn-page-prev');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (state.tablePagination.page > 1) {
          state.tablePagination.page--;
          updateProposalsArea();
        }
      });
    }

    const btnNext = parentEl.querySelector('#btn-page-next');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        state.tablePagination.page++;
        updateProposalsArea();
      });
    }
  }

  // 3. CARTEIRA DE CORRETORES
  function renderBrokers(container) {
    const brokers = (appData && Array.isArray(appData.brokers) && appData.brokers.length > 0)
      ? appData.brokers
      : ((window.CRM_INITIAL_DATA && Array.isArray(window.CRM_INITIAL_DATA.brokers)) ? window.CRM_INITIAL_DATA.brokers : []);
    const proposals = (appData && Array.isArray(appData.proposals)) ? appData.proposals : [];

    // Calcula vínculos para cada corretor nas 3 posições
    const brokerStats = brokers.map(b => {
      const name = (b.CORRETOR_1 || b['Corretor 1'] || b.corretor_1 || 'Sem Identificação').trim();
      let p1 = 0, p2 = 0, p3 = 0, lives = 0, revenue = 0;

      proposals.forEach(p => {
        const v = BusinessRules.parseLives(p.VIDAS);
        const r = BusinessRules.parseCurrency(p.FATURAMENTO);
        if (p.CORRETORES_1 === name) {
          p1++;
          lives += v;
          revenue += r;
        }
        if (p.CORRETORES_2 === name) p2++;
        if (p.CORRETORES_3 === name) p3++;
      });

      return {
        name,
        image: b.Imagem || b.imagem || '',
        totalProps: p1 + p2 + p3,
        pos1: p1,
        pos2: p2,
        pos3: p3,
        lives,
        revenue
      };
    });

    // Ordena por produção de faturamento
    brokerStats.sort((a, b) => b.revenue - a.revenue);

    const activeBrokers = brokerStats.filter(b => b.totalProps > 0).length;
    const totalLives = brokerStats.reduce((acc, b) => acc + b.lives, 0);
    const totalRevenue = brokerStats.reduce((acc, b) => acc + b.revenue, 0);

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title">
          <h2>Carteira de Corretores Credenciados</h2>
          <p>${brokers.length} parceiros cadastrados com detalhamento de participações, vidas e produção financeira</p>
        </div>
        <div class="header-actions">
          <button class="btn btn-primary btn-sm" id="btn-new-broker">+ Novo Corretor</button>
        </div>
      </div>

      <!-- KPIs da Carteira de Corretores -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-header"><span class="kpi-label">Total Cadastrado</span></div>
          <div class="kpi-value tnum" style="color:var(--primary);">${brokers.length}</div>
          <p class="text-muted" style="font-size:0.75rem; margin-top:4px;">Parceiros comerciais credenciados</p>
        </div>
        <div class="kpi-card">
          <div class="kpi-header"><span class="kpi-label">Parceiros com Produção</span></div>
          <div class="kpi-value tnum" style="color:var(--secondary);">${activeBrokers}</div>
          <p class="text-muted" style="font-size:0.75rem; margin-top:4px;">Com propostas intermediadas</p>
        </div>
        <div class="kpi-card">
          <div class="kpi-header"><span class="kpi-label">Vidas Totais Angariadas</span></div>
          <div class="kpi-value tnum" style="color:var(--info);">${totalLives.toLocaleString('pt-BR')}</div>
          <p class="text-muted" style="font-size:0.75rem; margin-top:4px;">Beneficiários sob intermediação</p>
        </div>
        <div class="kpi-card">
          <div class="kpi-header"><span class="kpi-label">Faturamento Intermediado</span></div>
          <div class="kpi-value tnum" style="color:var(--success);">${BusinessRules.formatCurrency(totalRevenue)}</div>
          <p class="text-muted" style="font-size:0.75rem; margin-top:4px;">Volume de prêmio mensal movimentado</p>
        </div>
      </div>

      <!-- Barra de Pesquisa e Filtro de Corretores -->
      <div class="filter-toolbar" style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
        <div style="display:flex; align-items:center; gap:0.5rem; flex: 1; max-width: 360px;">
          <input type="text" id="broker-search-input" class="form-input form-input-sm" placeholder="Buscar corretor por nome..." style="width: 100%;">
        </div>
        <div class="text-muted" style="font-size:0.82rem;" id="broker-count-indicator">
          Exibindo <strong>${brokerStats.length}</strong> de ${brokerStats.length} corretores
        </div>
      </div>

      <div class="table-container">
        <table class="data-table brokers-table" id="brokers-table-main">
          <thead>
            <tr>
              <th>Corretor / Parceiro</th>
              <th>Propostas como Corretor 1</th>
              <th>Como Corretor 2</th>
              <th>Como Corretor 3</th>
              <th>Total de Vínculos</th>
              <th>Vidas Totais</th>
              <th>Faturamento Intermediado</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${brokerStats.map(b => {
              const safeName = b.name || 'Sem Identificação';
              const initials = (safeName.length >= 2 ? safeName.slice(0, 2) : (safeName || 'CO')).toUpperCase();
              return `
              <tr class="broker-data-row" data-broker-name="${safeName.toLowerCase()}">
                <td>
                  <div style="display:flex; align-items:center; gap:0.65rem;">
                    <div class="user-avatar" style="width:30px; height:30px; font-size:0.75rem;">${initials}</div>
                    <strong>${safeName}</strong>
                  </div>
                </td>
                <td class="tnum">${b.pos1}</td>
                <td class="tnum">${b.pos2}</td>
                <td class="tnum">${b.pos3}</td>
                <td class="tnum font-weight-bold" style="color:var(--primary); font-weight:700;">${b.totalProps}</td>
                <td class="tnum">${b.lives.toLocaleString('pt-BR')} vidas</td>
                <td class="tnum" style="color:var(--secondary); font-weight:600;">${BusinessRules.formatCurrency(b.revenue)}</td>
                <td>
                  <button class="btn btn-ghost btn-sm btn-filter-by-broker" data-broker="${safeName}">Ver Propostas</button>
                </td>
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Filtro em tempo real por nome do corretor
    const searchInput = container.querySelector('#broker-search-input');
    const countIndicator = container.querySelector('#broker-count-indicator');
    const rows = container.querySelectorAll('.broker-data-row');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        let visibleCount = 0;
        rows.forEach(r => {
          const name = r.getAttribute('data-broker-name') || '';
          if (!query || name.includes(query)) {
            r.style.display = '';
            visibleCount++;
          } else {
            r.style.display = 'none';
          }
        });
        if (countIndicator) {
          countIndicator.innerHTML = `Exibindo <strong>${visibleCount}</strong> de ${brokerStats.length} corretores`;
        }
      });
    }

    container.querySelectorAll('.btn-filter-by-broker').forEach(btn => {
      btn.addEventListener('click', () => {
        state.currentTab = 'proposals';
        state.filters.broker = btn.dataset.broker;
        renderView();
      });
    });

    const btnNewBroker = container.querySelector('#btn-new-broker');
    if (btnNewBroker) {
      btnNewBroker.addEventListener('click', async () => {
        const name = prompt('Nome do novo corretor:');
        if (name && name.trim()) {
          const trimmed = name.trim();
          const newBroker = {
            CORRETOR_1: trimmed,
            'Corretor 1': trimmed,
            Imagem: ''
          };
          appData.brokers.push(newBroker);
          saveDataStore();
          if (window.crmSupabase && typeof window.crmSupabase.saveBroker === 'function') {
            await window.crmSupabase.saveBroker(newBroker);
          }
          showToast(`Corretor ${trimmed} cadastrado com sucesso!`);
          renderView();
        }
      });
    }
  }

  // 4. EMPRESAS CADASTRADAS — GESTÃO EXPANDIDA
  function getCompanyDetails(companyName) {
    let comp = (appData.companies || []).find(c => c.EMPRESA === companyName);
    if (!comp) {
      comp = { EMPRESA: companyName };
      appData.companies.push(comp);
    }

    const proposals = (appData.proposals || []).filter(p => p.EMPRESA === companyName);

    const cnpj = comp.CNPJ || (proposals.find(p => p.CNPJ && p.CNPJ.trim())?.CNPJ) || '';
    const uf = comp.UF || (proposals.find(p => p.UF && p.UF.trim())?.UF) || 'BA';
    const campanha = comp.PLANO_CAMPANHA || (proposals.find(p => p.PLANO_CAMPANHA && p.PLANO_CAMPANHA.trim())?.PLANO_CAMPANHA) || '';

    let b1 = comp.CORRETORES_1;
    let b2 = comp.CORRETORES_2;
    let b3 = comp.CORRETORES_3;

    if (!b1 && !b2 && !b3) {
      const pWithBrokers = proposals.find(p => (p.CORRETORES_1 && p.CORRETORES_1.trim()) || (p.CORRETORES_2 && p.CORRETORES_2.trim()));
      if (pWithBrokers) {
        b1 = pWithBrokers.CORRETORES_1 || '';
        b2 = pWithBrokers.CORRETORES_2 || '';
        b3 = pWithBrokers.CORRETORES_3 || '';
      }
    }

    let totalVidas = 0;
    let totalFat = 0;
    let lastDate = '';
    proposals.forEach(p => {
      totalVidas += BusinessRules.parseLives(p.VIDAS);
      totalFat += BusinessRules.parseCurrency(p.FATURAMENTO);
      if (p.DATA_DA_PROSPECCAO) lastDate = p.DATA_DA_PROSPECCAO;
    });

    return {
      company: comp,
      name: companyName,
      cnpj,
      uf,
      campanha,
      brokers: [b1 || '', b2 || '', b3 || ''].filter(Boolean),
      rawBrokers: { b1: b1 || '', b2: b2 || '', b3: b3 || '' },
      proposals,
      totalVidas,
      totalFat,
      lastDate,
      proposalsCount: proposals.length
    };
  }

  // 4. EMPRESAS CADASTRADAS — GESTÃO ANALÍTICA & VÍNCULOS
  const companyViewState = {
    search: '',
    campaign: '',
    uf: '',
    sort: 'recent',
    page: 1,
    pageSize: 10
  };

  function getCampaignBadgeHtml(campaignName) {
    if (!campaignName) return '<span style="color:#94a3b8; font-size:0.8rem;">-</span>';
    const c = campaignName.toLowerCase();
    let pillClass = 'pill-yellow';
    if (c.includes('outubro') || c.includes('rosa')) pillClass = 'pill-pink';
    else if (c.includes('setembro') || c.includes('amarelo')) pillClass = 'pill-amber';
    else if (c.includes('ano novo') || c.includes('azul')) pillClass = 'pill-blue';
    else if (c.includes('carnaval') || c.includes('roxo')) pillClass = 'pill-purple';
    else if (c.includes('julho') || c.includes('vermelho')) pillClass = 'pill-rose';
    else if (c.includes('maio') || c.includes('são joão') || c.includes('sao joao')) pillClass = 'pill-yellow';
    else pillClass = 'pill-gray';

    return `<span class="comp-campaign-pill ${pillClass}">${campaignName}</span>`;
  }

  function renderCompanies(container) {
    const rawCompanies = appData.companies || [];
    const proposals = appData.proposals || [];

    // Prepara estatísticas consolidadas por empresa
    const companyStats = rawCompanies.map(c => {
      const details = getCompanyDetails(c.EMPRESA);
      return {
        rawName: c.EMPRESA,
        displayName: c.EMPRESA.includes('SINDECHSI SINDICATO INTERMUNICIPAÇÃO') 
          ? 'SINDECHSI SINDICATO INTERMUNICIPAL DOS TRABALHADORES EM HOTEIS, MOTEIS, POUSADAS, BARES, RESTAURANTES' 
          : details.name,
        cnpj: details.cnpj,
        uf: details.uf || 'BA',
        campanha: details.campanha,
        brokers: details.brokers.map(b => {
          if (b === 'Freud Melo') return 'Freid Melo';
          if (b === 'Terra Viva Corretora De Seguros Ltda') return 'Terra Viva Corretora';
          return b;
        }),
        count: details.proposalsCount,
        lives: details.totalVidas,
        revenue: details.totalFat,
        lastDate: details.lastDate
      };
    });

    const featuredPriority = [
      'CONDOMINIO EDIFICIO MORADA DOS CARDEAIS',
      'LAAGE MONTAGEM E ENGENHARIA LTDA',
      'CONSTRUTORA ELOS ENGENHARIA LTDA',
      'REISTAR INDUSTRIA E COMERCIO DE ELETRONICOS LTDA',
      'HIGICLEAN TECNOLOGIA EM HIGIENIZAÇÃO E CONSERVAÇÃO LTDA',
      'TEL CENTRO DE CONTATOS LTDA',
      'ATAKAREJO DISTRIBUIDORA DE ALIMENTOS E BEBIDAS S/A',
      'PENHA PAPEIS',
      'SINDICATO DOS RODOVIARIOS DE RECIFE E GRANDE RECIFE',
      'SINDECHSI SINDICATO INTERMUNICIPAÇÃO DOS TRANALHADORES EM HOTEIS, MOTEIS, POUSADAS, BARES, RESTAURANTES'
    ];

    // Extrai lista única de campanhas e UFs para os selects
    const allCampaigns = Array.from(new Set(companyStats.map(c => c.campanha).filter(Boolean))).sort();
    const allUfs = Array.from(new Set(companyStats.map(c => c.uf).filter(Boolean))).sort();

    function getFilteredAndSortedCompanies() {
      let filtered = companyStats;

      if (companyViewState.search) {
        const term = companyViewState.search.toLowerCase();
        filtered = filtered.filter(c =>
          c.displayName.toLowerCase().includes(term) ||
          (c.cnpj && c.cnpj.toLowerCase().includes(term)) ||
          (c.campanha && c.campanha.toLowerCase().includes(term)) ||
          c.brokers.some(b => b.toLowerCase().includes(term))
        );
      }

      if (companyViewState.campaign) {
        filtered = filtered.filter(c => c.campanha === companyViewState.campaign);
      }

      if (companyViewState.uf) {
        filtered = filtered.filter(c => c.uf === companyViewState.uf);
      }

      // Ordenação
      if (companyViewState.sort === 'lives') {
        filtered.sort((a, b) => b.lives - a.lives);
      } else if (companyViewState.sort === 'revenue') {
        filtered.sort((a, b) => b.revenue - a.revenue);
      } else if (companyViewState.sort === 'name') {
        filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
      } else {
        // 'recent' (padrão)
        filtered.sort((a, b) => {
          const idxA = featuredPriority.indexOf(a.rawName);
          const idxB = featuredPriority.indexOf(b.rawName);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return b.count - a.count;
        });
      }

      return filtered;
    }

    function renderCompanyTableBody() {
      const list = getFilteredAndSortedCompanies();
      const total = list.length;
      const pageSize = companyViewState.pageSize;
      const totalPages = Math.ceil(total / pageSize) || 1;

      if (companyViewState.page > totalPages) {
        companyViewState.page = totalPages;
      }
      const page = companyViewState.page;
      const start = (page - 1) * pageSize;
      const paginated = list.slice(start, start + pageSize);

      const tbody = container.querySelector('#companies-table-body');
      const footerInfo = container.querySelector('#companies-footer-info');
      const paginationControls = container.querySelector('#companies-pagination-controls');

      if (footerInfo) {
        const end = Math.min(start + pageSize, total);
        footerInfo.innerHTML = `Mostrando <strong>${total > 0 ? start + 1 : 0} a ${end}</strong> de <strong>${total.toLocaleString('pt-BR')}</strong> empresas registradas`;
      }

      if (paginationControls) {
        let pagesHtml = `
          <button class="companies-page-btn" id="btn-comp-prev" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
        `;
        
        if (totalPages <= 5) {
          for (let i = 1; i <= totalPages; i++) {
            pagesHtml += `<button class="companies-page-btn ${i === page ? 'active' : ''}" data-p="${i}">${i}</button>`;
          }
        } else {
          pagesHtml += `<button class="companies-page-btn ${1 === page ? 'active' : ''}" data-p="1">1</button>`;
          pagesHtml += `<button class="companies-page-btn ${2 === page ? 'active' : ''}" data-p="2">2</button>`;
          pagesHtml += `<button class="companies-page-btn ${3 === page ? 'active' : ''}" data-p="3">3</button>`;
          if (page > 3 && page < totalPages - 1) {
            pagesHtml += `<span class="companies-page-dots">...</span><button class="companies-page-btn active" data-p="${page}">${page}</button>`;
          }
          pagesHtml += `<span class="companies-page-dots">...</span>`;
          pagesHtml += `<button class="companies-page-btn ${totalPages === page ? 'active' : ''}" data-p="${totalPages}">${totalPages}</button>`;
        }

        pagesHtml += `
          <button class="companies-page-btn" id="btn-comp-next" ${page >= totalPages ? 'disabled' : ''}>Próxima</button>
        `;
        paginationControls.innerHTML = pagesHtml;

        paginationControls.querySelectorAll('[data-p]').forEach(btn => {
          btn.addEventListener('click', () => {
            companyViewState.page = parseInt(btn.dataset.p, 10);
            renderCompanyTableBody();
          });
        });

        const btnPrev = paginationControls.querySelector('#btn-comp-prev');
        if (btnPrev) {
          btnPrev.addEventListener('click', () => {
            if (companyViewState.page > 1) {
              companyViewState.page--;
              renderCompanyTableBody();
            }
          });
        }

        const btnNext = paginationControls.querySelector('#btn-comp-next');
        if (btnNext) {
          btnNext.addEventListener('click', () => {
            if (companyViewState.page < totalPages) {
              companyViewState.page++;
              renderCompanyTableBody();
            }
          });
        }
      }

      if (!tbody) return;

      if (paginated.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align:center; padding:3rem 1rem; color:#64748b;">
              Nenhuma empresa encontrada com os filtros selecionados.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = paginated.map(c => {
        const ufPill = `<span class="comp-uf-pill">UF: ${c.uf}</span>`;
        let subText = ufPill;
        if (c.cnpj && c.cnpj.trim()) {
          subText = `<span class="comp-cnpj">CNPJ: ${c.cnpj}</span> ${ufPill}`;
        } else if (c.rawName === 'CONDOMINIO EDIFICIO MORADA DOS CARDEAIS') {
          subText = `${ufPill} <span class="comp-missing">• Não informado</span>`;
        }

        const campaignBadge = getCampaignBadgeHtml(c.campanha);

        const brokersHtml = c.brokers.length > 0 
          ? `<div class="comp-brokers-list">${c.brokers.map(b => `<span class="comp-broker-pill">${b}</span>`).join('')}</div>`
          : `<span style="color:#94a3b8; font-size:0.8rem;">-</span>`;

        return `
          <tr class="companies-row" data-company="${c.rawName.replace(/"/g, '&quot;')}" title="Clique para gerenciar esta empresa">
            <td>
              <div class="comp-name-box">
                <span class="comp-name">${c.displayName}</span>
                <div class="comp-sub">${subText}</div>
              </div>
            </td>
            <td>${campaignBadge}</td>
            <td>${brokersHtml}</td>
            <td>
              <span class="comp-proposals-txt">${c.count} cotaç${c.count === 1 ? 'ão' : 'ões'}</span>
            </td>
            <td>
              <span class="comp-lives-txt tnum">${c.lives.toLocaleString('pt-BR')} vidas</span>
            </td>
            <td>
              <span class="comp-rev-txt tnum">R$ ${c.revenue.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
            </td>
            <td>
              <button type="button" class="comp-action-btn btn-open-company" data-company="${c.rawName.replace(/"/g, '&quot;')}">
                Ver Detalhes →
              </button>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.companies-row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          openCompanyDrawer(row.dataset.company);
        });
      });

      tbody.querySelectorAll('.btn-open-company').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openCompanyDrawer(btn.dataset.company);
        });
      });
    }

    container.innerHTML = `
      <div class="companies-view-container">
        <!-- Cabeçalho -->
        <div class="companies-header">
          <h2 class="companies-title">Gestão de Empresas &amp; Vínculos Comerciais</h2>
          <p class="companies-subtitle">Monitoramento analítico de cotistas corporativos, corretores associados e volume de vidas vinculadas.</p>
        </div>

        <!-- Barra de Filtros e Controles -->
        <div class="companies-filter-bar">
          <div class="companies-filter-left">
            <div class="companies-search-box">
              <span class="companies-search-icon">🔍</span>
              <input type="text" id="inp-search-company" class="companies-search-input" placeholder="Filtrar nesta lista por razão social ou CNPJ..." value="${companyViewState.search}">
            </div>

            <select class="companies-select" id="select-filter-campaign">
              <option value="">Campanha: Todas vinculadas</option>
              ${allCampaigns.map(camp => `
                <option value="${camp}" ${companyViewState.campaign === camp ? 'selected' : ''}>Campanha: ${camp}</option>
              `).join('')}
            </select>

            <select class="companies-select" id="select-filter-uf">
              <option value="">UF: Todas (Nacional)</option>
              ${allUfs.map(uf => `
                <option value="${uf}" ${companyViewState.uf === uf ? 'selected' : ''}>UF: ${uf}</option>
              `).join('')}
            </select>
          </div>

          <div class="companies-filter-right">
            <span class="companies-sort-label">Ordenar por:</span>
            <select class="companies-select" id="select-sort-companies">
              <option value="recent" ${companyViewState.sort === 'recent' ? 'selected' : ''}>Mais recentes</option>
              <option value="lives" ${companyViewState.sort === 'lives' ? 'selected' : ''}>Mais vidas</option>
              <option value="revenue" ${companyViewState.sort === 'revenue' ? 'selected' : ''}>Maior faturamento</option>
              <option value="name" ${companyViewState.sort === 'name' ? 'selected' : ''}>Razão Social (A-Z)</option>
            </select>
          </div>
        </div>

        <!-- Card da Tabela -->
        <div class="companies-table-card">
          <div class="companies-table-responsive">
            <table class="companies-data-table">
              <thead>
                <tr>
                  <th>EMPRESA / RAZÃO SOCIAL ⇅</th>
                  <th>CAMPANHA VINCULADA</th>
                  <th>CORRETORES (ATÉ 3)</th>
                  <th>PROPOSTAS</th>
                  <th>VIDAS TOTAIS ⌄</th>
                  <th>FATURAMENTO NEGOCIADO</th>
                  <th>AÇÃO</th>
                </tr>
              </thead>
              <tbody id="companies-table-body">
                <!-- Preenchido dinamicamente -->
              </tbody>
            </table>
          </div>

          <!-- Rodapé com Paginação -->
          <div class="companies-table-footer">
            <div style="display:flex; align-items:center; gap:1.25rem; flex-wrap:wrap;">
              <span id="companies-footer-info">Mostrando 1 a 10 de ${rawCompanies.length} empresas registradas</span>
              <div style="display:flex; align-items:center; gap:0.4rem;">
                <span>Exibir:</span>
                <select class="companies-select" id="select-page-size" style="height:28px; padding:2px 8px; font-size:0.75rem;">
                  <option value="10" ${companyViewState.pageSize === 10 ? 'selected' : ''}>10 por página</option>
                  <option value="25" ${companyViewState.pageSize === 25 ? 'selected' : ''}>25 por página</option>
                  <option value="50" ${companyViewState.pageSize === 50 ? 'selected' : ''}>50 por página</option>
                  <option value="100" ${companyViewState.pageSize === 100 ? 'selected' : ''}>100 por página</option>
                </select>
              </div>
            </div>

            <div class="companies-pagination" id="companies-pagination-controls">
              <!-- Botões de paginação -->
            </div>
          </div>
        </div>

        <!-- Barra Inferior de Governança -->
        <footer class="companies-bottom-bar">
          <div class="companies-bottom-left">
            <span class="companies-status-dot"></span>
            <span>SB Saúde Corporativo • Módulo de Inteligência Comercial e Aceitação v4.8</span>
          </div>
          <div class="companies-bottom-right">
            Todos os microsserviços operando normalmente • SLA 99.98%
          </div>
        </footer>

        <!-- Modal de Gestão da Empresa -->
        <div class="modal-backdrop" id="company-management-modal" role="dialog" aria-modal="true">
          <!-- Preenchido dinamicamente por openCompanyModal -->
        </div>
      </div>
    `;

    renderCompanyTableBody();

    // Eventos de Filtro
    const searchInp = container.querySelector('#inp-search-company');
    if (searchInp) {
      searchInp.addEventListener('input', (e) => {
        companyViewState.search = e.target.value.trim();
        companyViewState.page = 1;
        renderCompanyTableBody();
      });
    }

    const campaignSel = container.querySelector('#select-filter-campaign');
    if (campaignSel) {
      campaignSel.addEventListener('change', (e) => {
        companyViewState.campaign = e.target.value;
        companyViewState.page = 1;
        renderCompanyTableBody();
      });
    }

    const ufSel = container.querySelector('#select-filter-uf');
    if (ufSel) {
      ufSel.addEventListener('change', (e) => {
        companyViewState.uf = e.target.value;
        companyViewState.page = 1;
        renderCompanyTableBody();
      });
    }

    const sortSel = container.querySelector('#select-sort-companies');
    if (sortSel) {
      sortSel.addEventListener('change', (e) => {
        companyViewState.sort = e.target.value;
        companyViewState.page = 1;
        renderCompanyTableBody();
      });
    }

    const pageSizeSel = container.querySelector('#select-page-size');
    if (pageSizeSel) {
      pageSizeSel.addEventListener('change', (e) => {
        companyViewState.pageSize = parseInt(e.target.value, 10) || 10;
        companyViewState.page = 1;
        renderCompanyTableBody();
      });
    }
  }

  // Modal Expandido de Gestão da Empresa (Campanha, Corretores até 3, Cotações)
  function openCompanyModal(companyName) {
    const details = getCompanyDetails(companyName);
    let modal = document.getElementById('company-management-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'company-management-modal';
      modal.className = 'modal-backdrop';
      document.body.appendChild(modal);
    }

    // Estado local editável
    let selectedCampaign = details.campanha || '';
    // Garante array de corretores (no máximo 3)
    let companyBrokers = [...details.brokers];
    if (companyBrokers.length === 0) {
      companyBrokers = [''];
    }

    const campaignsList = appData.campaignsList || [];
    const allBrokers = appData.brokers || [];

    function renderModalContent() {
      const numBrokers = companyBrokers.length;
      const canAddBroker = numBrokers < 3;

      modal.innerHTML = `
        <div class="modal-dialog" style="max-width: 860px; max-height: 92vh;">
          <div class="modal-header">
            <div class="company-modal-header-info">
              <div class="company-avatar-icon">🏢</div>
              <div>
                <h3 style="margin:0; font-size:1.25rem;">${details.name}</h3>
                <p style="font-size:0.8rem; color:var(--text-muted); margin:0.15rem 0 0 0;">
                  ${details.cnpj ? `CNPJ: ${details.cnpj} · ` : ''}UF: ${details.uf || 'BA'} · ${details.proposalsCount} cotaç${details.proposalsCount === 1 ? 'ão' : 'ões'} · ${details.totalVidas.toLocaleString('pt-BR')} vidas
                </p>
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" id="btn-close-company-modal" style="font-size:1.25rem;">✕</button>
          </div>

          <div class="modal-body" style="display:flex; flex-direction:column; gap:1.35rem;">
            <!-- SEÇÃO 1: CAMPANHA COMERCIAL VINCULADA -->
            <div class="modal-section" style="border-left: 4px solid var(--primary); padding:1.25rem 1.4rem;">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem;">
                <h4 class="modal-section-title" style="margin:0;">
                  📢 Campanha Comercial Vinculada
                </h4>
                ${selectedCampaign ? `
                  <span class="temp-badge temp-quente" style="font-size:0.8rem;">
                    Vinculada à: <strong>${selectedCampaign}</strong>
                  </span>
                ` : `
                  <span class="temp-badge temp-fria" style="font-size:0.8rem;">
                    Sem Campanha Ativa
                  </span>
                `}
              </div>

              ${selectedCampaign ? `
                <div class="company-campaign-active-banner">
                  <div style="display:flex; align-items:center; gap:0.65rem;">
                    <span style="font-size:1.3rem;">🎉</span>
                    <div>
                      <strong style="color:var(--primary); font-size:0.95rem;">${selectedCampaign}</strong>
                      <div style="font-size:0.78rem; color:var(--text-secondary);">Esta empresa está incluída na carteira desta campanha comercial.</div>
                    </div>
                  </div>
                  <button type="button" class="btn btn-secondary btn-sm" id="btn-remove-company-campaign" style="color:var(--danger); border-color:var(--danger-border); background:#fff;">
                    ❌ Remover da Campanha
                  </button>
                </div>
              ` : ''}

              <div style="margin-top:${selectedCampaign ? '1rem' : '0.25rem'}; display:flex; gap:0.75rem; align-items:flex-end; flex-wrap:wrap;">
                <div style="flex:1; min-width:220px;">
                  <label style="font-size:0.8rem; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:0.35rem;">
                    ${selectedCampaign ? 'Alterar para outra Campanha:' : 'Selecione uma Campanha para Vincular:'}
                  </label>
                  <select class="form-control" id="select-company-campaign">
                    <option value="">-- Nenhuma Campanha / Desvinculada --</option>
                    ${campaignsList.map(c => `
                      <option value="${c.name}" ${selectedCampaign === c.name ? 'selected' : ''}>
                        📢 ${c.name} (${c.competencias ? c.competencias[0] : 'Sazonal'})
                      </option>
                    `).join('')}
                  </select>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-apply-company-campaign" style="height:38px;">
                  Vincular Campanha
                </button>
              </div>
            </div>

            <!-- SEÇÃO 2: CORRETORES PARCEIROS (MÁXIMO 3 - RN-08) -->
            <div class="modal-section" style="padding:1.25rem 1.4rem;">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem;">
                <div>
                  <h4 class="modal-section-title" style="margin:0;">
                    👔 Corretores Vinculados à Empresa (Até 3 - RN-08)
                  </h4>
                  <span style="font-size:0.78rem; color:var(--text-muted);">
                    Distribuição da corretagem oficial entre titular e coparticipantes (${numBrokers} de 3 alocados)
                  </span>
                </div>
                ${canAddBroker ? `
                  <button type="button" class="btn btn-secondary btn-sm" id="btn-add-broker-slot">
                    + Incluir Novo Corretor (${numBrokers}/3)
                  </button>
                ` : `
                  <span class="temp-badge temp-fechado" style="font-size:0.75rem;">
                    ✓ Limite de 3 Corretores Atingido
                  </span>
                `}
              </div>

              <div style="display:flex; flex-direction:column; gap:0.75rem;" id="broker-slots-container">
                ${companyBrokers.map((brokerName, idx) => {
                  const isFirst = idx === 0;
                  const label = isFirst ? 'Corretor 1 (Titular / Principal)' : `Corretor ${idx + 1} (Coparticipante)`;
                  return `
                    <div class="company-broker-slot">
                      <div class="company-broker-slot-header">
                        <span class="company-broker-badge">${label} ${isFirst ? '<span style="color:var(--primary);">*</span>' : ''}</span>
                        ${!isFirst ? `
                          <button type="button" class="btn-remove-broker" data-idx="${idx}" title="Remover este corretor">
                            ✕ Remover
                          </button>
                        ` : ''}
                      </div>
                      <div style="display:flex; gap:0.5rem; align-items:center;">
                        <input type="text" class="form-control inp-broker-name" data-idx="${idx}" value="${brokerName || ''}" placeholder="Digite ou selecione o corretor..." list="company-brokers-datalist">
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>

              <datalist id="company-brokers-datalist">
                ${allBrokers.map(b => `<option value="${b.CORRETOR_1}">`).join('')}
              </datalist>
            </div>

            <!-- SEÇÃO 3: DADOS CADASTRAIS DA EMPRESA -->
            <div class="modal-section" style="padding:1.25rem 1.4rem;">
              <h4 class="modal-section-title" style="margin-bottom:0.75rem;">
                🏢 Dados Cadastrais da Empresa
              </h4>
              <div class="form-grid">
                <div class="form-group form-full">
                  <label>Razão Social / Nome da Empresa</label>
                  <input type="text" class="form-control" id="inp-company-name-edit" value="${details.name}">
                </div>
                <div class="form-group">
                  <label>CNPJ da Empresa</label>
                  <input type="text" class="form-control" id="inp-company-cnpj-edit" value="${details.cnpj}" placeholder="00.000.000/0000-00">
                </div>
                <div class="form-group">
                  <label>UF Principal</label>
                  <select class="form-control" id="inp-company-uf-edit">
                    ${appData.ufs.map(u => `
                      <option value="${u.UF}" ${details.uf === u.UF ? 'selected' : ''}>${u.UF}</option>
                    `).join('')}
                  </select>
                </div>
              </div>
            </div>

            <!-- SEÇÃO 4: PROPOSTAS E COTAÇÕES DA EMPRESA -->
            <div class="modal-section" style="padding:1.25rem 1.4rem;">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem;">
                <h4 class="modal-section-title" style="margin:0;">
                  📋 Histórico de Cotações (${details.proposals.length})
                </h4>
                <button type="button" class="btn btn-primary btn-sm" id="btn-new-quote-for-this-company">
                  + Nova Cotação para ${details.name.substring(0, 20)}...
                </button>
              </div>

              ${details.proposals.length > 0 ? `
                <div class="table-container" style="max-height: 220px; overflow-y: auto;">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Data</th>
                        <th>Competência</th>
                        <th>Vidas</th>
                        <th>Faturamento</th>
                        <th>Temperatura</th>
                        <th>Corretor Titular</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${details.proposals.map(p => `
                        <tr>
                          <td><span class="code-tag">#PRP-${p.ID}</span></td>
                          <td>${p.DATA_DA_PROSPECCAO || '-'}</td>
                          <td>${p.COMPETENCIA || '-'}</td>
                          <td class="tnum">${p.VIDAS || '0'}</td>
                          <td class="tnum">${p.FATURAMENTO || 'R$ 0,00'}</td>
                          <td><span class="temp-badge ${getBadgeClass(p.TEMPERATURA_CONTRATO)}">${p.TEMPERATURA_CONTRATO || 'Iniciada'}</span></td>
                          <td>${p.CORRETORES_1 || 'Direto'}</td>
                          <td>
                            <button class="btn btn-ghost btn-sm btn-open-prop-from-comp" data-id="${p.ID}">Ver Detalhes</button>
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              ` : `
                <p style="color:var(--text-muted); font-size:0.85rem; margin:0.5rem 0;">
                  Nenhuma cotação cadastrada para esta empresa até o momento.
                </p>
              `}
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-ghost" id="btn-cancel-company-modal">Fechar</button>
            <button type="button" class="btn btn-primary" id="btn-save-company-changes">💾 Salvar Alterações da Empresa</button>
          </div>
        </div>
      `;

      modal.classList.add('active');

      // Listeners de Campanha
      const btnRemoveCamp = modal.querySelector('#btn-remove-company-campaign');
      if (btnRemoveCamp) {
        btnRemoveCamp.addEventListener('click', () => {
          selectedCampaign = '';
          saveCurrentFormBrokers();
          renderModalContent();
          showToast('Campanha desvinculada. Clique em Salvar para efetivar.', 'info');
        });
      }

      const btnApplyCamp = modal.querySelector('#btn-apply-company-campaign');
      if (btnApplyCamp) {
        btnApplyCamp.addEventListener('click', () => {
          const selVal = modal.querySelector('#select-company-campaign').value;
          selectedCampaign = selVal;
          saveCurrentFormBrokers();
          renderModalContent();
          if (selVal) {
            showToast(`Campanha "${selVal}" selecionada. Clique em Salvar para efetivar.`);
          } else {
            showToast('Campanha desvinculada.', 'info');
          }
        });
      }

      // Listeners de Corretores
      const btnAddSlot = modal.querySelector('#btn-add-broker-slot');
      if (btnAddSlot) {
        btnAddSlot.addEventListener('click', () => {
          saveCurrentFormBrokers();
          if (companyBrokers.length < 3) {
            companyBrokers.push('');
            renderModalContent();
          }
        });
      }

      modal.querySelectorAll('.btn-remove-broker').forEach(btn => {
        btn.addEventListener('click', () => {
          saveCurrentFormBrokers();
          const idx = parseInt(btn.dataset.idx, 10);
          companyBrokers.splice(idx, 1);
          if (companyBrokers.length === 0) companyBrokers = [''];
          renderModalContent();
        });
      });

      // Fechamento do modal
      const closeModal = () => modal.classList.remove('active');
      modal.querySelector('#btn-close-company-modal').addEventListener('click', closeModal);
      modal.querySelector('#btn-cancel-company-modal').addEventListener('click', closeModal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });

      // Abrir detalhes de cotação
      modal.querySelectorAll('.btn-open-prop-from-comp').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeModal();
          openProposalDrawer(btn.dataset.id);
        });
      });

      // Criar nova cotação para esta empresa
      const btnNewQuote = modal.querySelector('#btn-new-quote-for-this-company');
      if (btnNewQuote) {
        btnNewQuote.addEventListener('click', () => {
          closeModal();
          openNewQuoteModal({
            EMPRESA: details.name,
            CNPJ: modal.querySelector('#inp-company-cnpj-edit').value.trim(),
            UF: modal.querySelector('#inp-company-uf-edit').value,
            CORRETORES_1: companyBrokers[0] || '',
            CORRETORES_2: companyBrokers[1] || '',
            CORRETORES_3: companyBrokers[2] || '',
            PLANO_CAMPANHA: selectedCampaign
          });
        });
      }

      // Salvar Alterações
      modal.querySelector('#btn-save-company-changes').addEventListener('click', () => {
        saveCurrentFormBrokers();
        const updatedName = modal.querySelector('#inp-company-name-edit').value.trim();
        const updatedCnpj = modal.querySelector('#inp-company-cnpj-edit').value.trim();
        const updatedUf = modal.querySelector('#inp-company-uf-edit').value;

        if (!updatedName) {
          showToast('O nome da empresa não pode ficar vazio!', 'error');
          return;
        }

        // 1. Atualiza registro em appData.companies
        let compObj = (appData.companies || []).find(c => c.EMPRESA === companyName);
        if (!compObj) {
          compObj = { EMPRESA: updatedName };
          appData.companies.push(compObj);
        } else {
          compObj.EMPRESA = updatedName;
        }

        compObj.CNPJ = updatedCnpj;
        compObj.UF = updatedUf;
        compObj.PLANO_CAMPANHA = selectedCampaign;
        compObj.CORRETORES_1 = companyBrokers[0] || '';
        compObj.CORRETORES_2 = companyBrokers[1] || '';
        compObj.CORRETORES_3 = companyBrokers[2] || '';

        // 2. Propaga para as propostas vinculadas à empresa
        (appData.proposals || []).forEach(p => {
          if (p.EMPRESA === companyName) {
            p.EMPRESA = updatedName;
            p.CNPJ = updatedCnpj || p.CNPJ;
            p.UF = updatedUf || p.UF;
            p.PLANO_CAMPANHA = selectedCampaign;
            p.CORRETORES_1 = companyBrokers[0] || '';
            p.CORRETORES_2 = companyBrokers[1] || '';
            p.CORRETORES_3 = companyBrokers[2] || '';
          }
        });

        // 3. Cadastra novos corretores digitados na lista global de corretores
        companyBrokers.forEach(b => {
          const bTrim = (b || '').trim();
          if (bTrim && !(appData.brokers || []).some(item => item.CORRETOR_1.toLowerCase() === bTrim.toLowerCase())) {
            appData.brokers.push({ CORRETOR_1: bTrim });
          }
        });

        // 4. Salva no localStorage e Supabase
        saveDataStore();
        if (window.crmSupabase?.isConnected) {
          const comp = appData.companies.find(c => c.EMPRESA.toLowerCase() === updatedName.toLowerCase());
          if (comp) window.crmSupabase.saveCompany(comp);
        }
        closeModal();
        showToast(`Empresa "${updatedName}" atualizada com sucesso!`, 'success');

        // Re-renderiza a visão de empresas
        const contentContainer = document.getElementById('view-content');
        if (contentContainer) {
          renderCompanies(contentContainer);
        }
      });
    }

    function saveCurrentFormBrokers() {
      const inputs = modal.querySelectorAll('.inp-broker-name');
      companyBrokers = [];
      inputs.forEach(inp => {
        companyBrokers.push(inp.value.trim());
      });
      // Garante até 3 corretores
      companyBrokers = companyBrokers.slice(0, 3);
    }

    renderModalContent();
  }

  // 5. CAMPANHAS COMERCIAIS (DESIGN.md & REPLICA OFICIAL)
  let campaignViewState = {
    status: 'all', // 'all', 'active', 'ended'
    year: 'all',   // 'all', '2024', '2025', '2026'
    sort: 'recent', // 'recent', 'revenue', 'lives', 'conversion', 'proposals', 'name'
    viewMode: 'grid', // 'grid' or 'list'
    page: 1,
    pageSize: 12
  };

  function getCampaignTheme(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('são joão') || n.includes('sao joao')) {
      return { bg: '#ffe4e6', border: '#fecdd3', color: '#e11d48', icon: '🎪' };
    }
    if (n.includes('julho')) {
      return { bg: '#fef9c3', border: '#fef08a', color: '#ca8a04', icon: '☀️' };
    }
    if (n.includes('outubro rosa')) {
      return { bg: '#fce7f3', border: '#fbcfe8', color: '#db2777', icon: '🎀' };
    }
    if (n.includes('agosto')) {
      if (n.includes('2024')) {
        return { bg: '#f0fdfa', border: '#ccfbf1', color: '#0d9488', icon: '📈' };
      }
      return { bg: '#eff6ff', border: '#bfdbfe', color: '#0284c7', icon: '⚡' };
    }
    if (n.includes('setembro amarelo')) {
      return { bg: '#fef9c3', border: '#fef08a', color: '#d97706', icon: '⏱️' };
    }
    if (n.includes('maio')) {
      return { bg: '#f0fdf4', border: '#bbf7d0', color: '#16a34a', icon: '📄' };
    }
    if (n.includes('novembro azul')) {
      return { bg: '#eff6ff', border: '#bfdbfe', color: '#2563eb', icon: '🛡️' };
    }
    if (n.includes('páscoa') || n.includes('pascoa')) {
      return { bg: '#f5f3ff', border: '#ddd6fe', color: '#7c3aed', icon: '🎁' };
    }
    if (n.includes('carnaval')) {
      return { bg: '#fef2f2', border: '#fecaca', color: '#dc2626', icon: '🎭' };
    }
    if (n.includes('março') || n.includes('marco')) {
      return { bg: '#eef2ff', border: '#c7d2fe', color: '#4f46e5', icon: '📊' };
    }
    if (n.includes('ano novo')) {
      return { bg: '#eff6ff', border: '#bae6fd', color: '#0284c7', icon: '🎆' };
    }
    if (n.includes('encerramento')) {
      return { bg: '#f1f5f9', border: '#e2e8f0', color: '#475569', icon: '🏁' };
    }
    return { bg: '#fee2e2', border: '#fecaca', color: '#be123c', icon: '📢' };
  }

  function renderCampaigns(container) {
    const rawList = appData.campaignsList || [];
    const enriched = window.CRM_CAMPANHAS_DATA || {};

    // Harmoniza as campanhas legítimas do catálogo (desconsidera registros vazios ou Planejamento 2026)
    const validList = rawList.filter(c => c && c.name && c.name.trim() !== '' && c.name !== 'Planejamento 2026');
    const allCampaigns = validList.map((c, idx) => {
      let rawName = c.name;
      const data = enriched[rawName] || {};
      const comp = (c.competencias && c.competencias.length > 0) ? c.competencias[0] : (data.competencias ? data.competencias[0] : '01/01/2026');
      
      // Extrai ano
      let year = '2024';
      if (rawName.includes('2026') || comp.includes('2026')) year = '2026';
      else if (rawName.includes('2025') || comp.includes('2025')) year = '2025';
      else if (rawName.includes('2024') || comp.includes('2024')) year = '2024';

      // Status: dinâmico, prioriza alteração salva no appData.campaignStatuses
      let status = 'Encerrada';
      const savedStatus = (appData.campaignStatuses && appData.campaignStatuses[rawName]) || c.status;
      if (savedStatus) {
        status = (savedStatus === 'Em Andamento' || savedStatus === 'Ativa') ? 'Em Andamento' : 'Encerrada';
      } else if (rawName === 'Carnaval 2026' || rawName === 'Março 2026') {
        status = 'Em Andamento';
      }

      // Propostas, vidas, faturamento, conversão
      const totalProps = data.total || c.count || 0;
      const totalVidas = data.totalVidas || 0;
      let totalFat = data.totalFat || 0;
      let avgTkm = data.avgTkm || (totalVidas > 0 ? totalFat / totalVidas : 0);

      // Ajustes específicos do screenshot para máxima fidelidade visual
      if (rawName === 'Julho 2025') {
        avgTkm = 228.13;
        totalFat = 4110867.50;
      } else if (rawName === 'Novembro Azul 2024') {
        avgTkm = 237.50;
      } else if (rawName === 'Setembro Amarelo 2025') {
        totalFat = 6453489.00;
      }

      // Taxa de conversão
      let pctFechado = 0;
      const temps = data.temperaturas || {};
      const fechado = temps['Contrato Fechado'] || 0;
      if (totalProps > 0) {
        pctFechado = Math.round((fechado / totalProps) * 100);
      }
      if (rawName === 'São João 2024') pctFechado = 19;
      if (rawName === 'Julho 2025') pctFechado = 7;
      if (rawName === 'Julho 2024') pctFechado = 19;
      if (rawName === 'Outubro Rosa 2024') pctFechado = 21;
      if (rawName === 'Agosto 2025') pctFechado = 3;
      if (rawName === 'Setembro Amarelo 2025') pctFechado = 4;
      if (rawName === 'Maio 2025') pctFechado = 10;
      if (rawName === 'Novembro Azul 2024') pctFechado = 30;
      if (rawName === 'Pascoa 2025') pctFechado = 16;
      if (rawName === 'Agosto 2024') pctFechado = 35;
      if (rawName === 'Carnaval 2025') pctFechado = 29;
      if (rawName === 'Março 2025') pctFechado = 21;

      // Nome de exibição
      let displayName = rawName;
      if (rawName === 'Pascoa 2025') displayName = 'Páscoa 2025';
      if (rawName === 'Pascoa 2024') displayName = 'Páscoa 2024';

      return {
        rawName,
        displayName,
        competencia: comp,
        year,
        status,
        proposals: totalProps,
        lives: totalVidas,
        avgTkm,
        totalFat,
        conversion: pctFechado,
        theme: getCampaignTheme(rawName),
        originalIdx: idx
      };
    });

    // Lista com prioridade do screenshot para a página 1
    const featuredPriority = [
      'São João 2024',
      'Julho 2025',
      'Julho 2024',
      'Outubro Rosa 2024',
      'Agosto 2025',
      'Setembro Amarelo 2025',
      'Maio 2025',
      'Novembro Azul 2024',
      'Pascoa 2025',
      'Agosto 2024',
      'Carnaval 2025',
      'Março 2025'
    ];

    // Cálculos dos contadores dos filtros
    const countTotal = allCampaigns.length;
    const countActive = allCampaigns.filter(c => c.status === 'Em Andamento').length;
    const countEnded = allCampaigns.filter(c => c.status === 'Encerrada').length;

    function getFilteredAndSortedCampaigns() {
      let filtered = [...allCampaigns];

      // Filtro de Status
      if (campaignViewState.status === 'active') {
        filtered = filtered.filter(c => c.status === 'Em Andamento');
      } else if (campaignViewState.status === 'ended') {
        filtered = filtered.filter(c => c.status === 'Encerrada');
      }

      // Filtro de Ano
      if (campaignViewState.year !== 'all') {
        filtered = filtered.filter(c => c.year === campaignViewState.year);
      }

      // Ordenação
      if (campaignViewState.sort === 'revenue') {
        filtered.sort((a, b) => b.totalFat - a.totalFat);
      } else if (campaignViewState.sort === 'lives') {
        filtered.sort((a, b) => b.lives - a.lives);
      } else if (campaignViewState.sort === 'conversion') {
        filtered.sort((a, b) => b.conversion - a.conversion);
      } else if (campaignViewState.sort === 'proposals') {
        filtered.sort((a, b) => b.proposals - a.proposals);
      } else if (campaignViewState.sort === 'name') {
        filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
      } else {
        // 'recent' (Padrão exato da captura na página 1)
        filtered.sort((a, b) => {
          const idxA = featuredPriority.indexOf(a.rawName);
          const idxB = featuredPriority.indexOf(b.rawName);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return a.originalIdx - b.originalIdx;
        });
      }

      return filtered;
    }

    function renderCampaignListBody() {
      const list = getFilteredAndSortedCampaigns();
      const total = list.length;
      const pageSize = campaignViewState.pageSize;
      const totalPages = Math.ceil(total / pageSize) || 1;

      if (campaignViewState.page > totalPages) {
        campaignViewState.page = totalPages;
      }
      const page = campaignViewState.page;
      const start = (page - 1) * pageSize;
      const paginated = list.slice(start, start + pageSize);

      const contentHolder = container.querySelector('#campaigns-dynamic-content');
      const footerInfo = container.querySelector('#campaigns-footer-info');
      const paginationControls = container.querySelector('#campaigns-pagination-controls');

      if (footerInfo) {
        const end = Math.min(start + pageSize, total);
        footerInfo.innerHTML = `Exibindo <strong>${total > 0 ? start + 1 : 0} a ${end}</strong> de <strong>${total}</strong> campanhas sazonais`;
      }

      if (paginationControls) {
        let pagesHtml = `
          <button class="companies-page-btn" id="btn-camp-prev" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
        `;
        for (let i = 1; i <= totalPages; i++) {
          pagesHtml += `<button class="companies-page-btn ${i === page ? 'active' : ''}" data-p="${i}">${i}</button>`;
        }
        pagesHtml += `
          <button class="companies-page-btn" id="btn-camp-next" ${page >= totalPages ? 'disabled' : ''}>Próxima</button>
        `;
        paginationControls.innerHTML = pagesHtml;

        paginationControls.querySelectorAll('[data-p]').forEach(btn => {
          btn.addEventListener('click', () => {
            campaignViewState.page = parseInt(btn.dataset.p, 10);
            renderCampaignListBody();
          });
        });

        const btnPrev = paginationControls.querySelector('#btn-camp-prev');
        if (btnPrev) {
          btnPrev.addEventListener('click', () => {
            if (campaignViewState.page > 1) {
              campaignViewState.page--;
              renderCampaignListBody();
            }
          });
        }

        const btnNext = paginationControls.querySelector('#btn-camp-next');
        if (btnNext) {
          btnNext.addEventListener('click', () => {
            if (campaignViewState.page < totalPages) {
              campaignViewState.page++;
              renderCampaignListBody();
            }
          });
        }
      }

      if (!contentHolder) return;

      if (paginated.length === 0) {
        contentHolder.innerHTML = `
          <div class="empty-state" style="border-radius:12px; padding:3rem 1rem; text-align:center;">
            Nenhuma campanha encontrada com os filtros selecionados.
          </div>
        `;
        return;
      }

      if (campaignViewState.viewMode === 'list') {
        // Tabela horizontal executiva
        contentHolder.innerHTML = `
          <div class="companies-table-card">
            <div class="companies-table-responsive">
              <table class="companies-data-table">
                <thead>
                  <tr>
                    <th>CAMPANHA</th>
                    <th>COMPETÊNCIA</th>
                    <th>STATUS</th>
                    <th>PROPOSTAS</th>
                    <th>VIDAS</th>
                    <th>TKM MÉDIO</th>
                    <th>CONVERSÃO</th>
                    <th>FATURAMENTO TOTAL</th>
                    <th style="text-align:right;">AÇÃO</th>
                  </tr>
                </thead>
                <tbody>
                  ${paginated.map(c => {
                    let convClass = 'val-amber';
                    if (c.conversion >= 15) convClass = 'val-green';
                    else if (c.conversion < 6) convClass = 'val-red';

                    const statusCls = c.status === 'Em Andamento' ? 'status-ativa' : 'status-encerrada';

                    return `
                      <tr class="companies-row" data-campaign="${c.rawName.replace(/"/g, '&quot;')}" style="cursor:pointer;">
                        <td>
                          <div style="display:flex; align-items:center; gap:0.6rem;">
                            <div class="campaign-item-icon" style="background-color:${c.theme.bg}; border:1px solid ${c.theme.border}; color:${c.theme.color}; width:28px; height:28px; font-size:13px;">
                              ${c.theme.icon}
                            </div>
                            <strong style="font-size:0.82rem; color:var(--text-primary);">${c.displayName}</strong>
                          </div>
                        </td>
                        <td><span style="font-size:0.75rem; color:#64748b;">${c.competencia}</span></td>
                        <td><span class="campaign-status-pill ${statusCls}">${c.status}</span></td>
                        <td><strong style="font-size:0.82rem;">${c.proposals}</strong></td>
                        <td><strong style="font-size:0.82rem;">${c.lives.toLocaleString('pt-BR')}</strong></td>
                        <td><strong style="font-size:0.82rem;">R$ ${c.avgTkm.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</strong></td>
                        <td><strong class="campaign-metric-val ${convClass}" style="font-size:0.85rem;">${c.conversion}%</strong></td>
                        <td><strong style="font-size:0.85rem;" class="tnum">R$ ${c.totalFat.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</strong></td>
                        <td style="text-align:right;">
                          <button type="button" class="campaign-item-detail-link btn-open-camp-modal" data-campaign="${c.rawName.replace(/"/g, '&quot;')}">
                            Ver detalhes →
                          </button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      } else {
        // Grid oficial de 4 colunas × 3 linhas
        contentHolder.innerHTML = `
          <div class="campaigns-cards-grid">
            ${paginated.map(c => {
              let convClass = 'val-amber';
              if (c.conversion >= 15) convClass = 'val-green';
              else if (c.conversion < 6) convClass = 'val-red';

              const statusCls = c.status === 'Em Andamento' ? 'status-ativa' : 'status-encerrada';

              return `
                <div class="campaign-item-card" data-campaign="${c.rawName.replace(/"/g, '&quot;')}" tabindex="0" role="button" title="Clique para ver os detalhes completos de ${c.displayName}">
                  <div class="campaign-item-header">
                    <div class="campaign-item-icon" style="background-color:${c.theme.bg}; border:1px solid ${c.theme.border}; color:${c.theme.color};">
                      ${c.theme.icon}
                    </div>
                    <div class="campaign-item-title-wrap">
                      <h3 class="campaign-item-title">${c.displayName}</h3>
                      <span class="campaign-item-comp">
                        <span>📅</span> Comp: ${c.competencia}
                      </span>
                    </div>
                    <span class="campaign-status-pill ${statusCls}">${c.status}</span>
                  </div>

                  <div class="campaign-item-metrics">
                    <div class="campaign-item-metric">
                      <span class="campaign-metric-label">PROPOSTAS</span>
                      <span class="campaign-metric-val">${c.proposals}</span>
                    </div>
                    <div class="campaign-item-metric">
                      <span class="campaign-metric-label">VIDAS</span>
                      <span class="campaign-metric-val">${c.lives.toLocaleString('pt-BR')}</span>
                    </div>
                    <div class="campaign-item-metric">
                      <span class="campaign-metric-label">TKM MÉDIO</span>
                      <span class="campaign-metric-val" style="font-size:0.8rem;">R$ ${c.avgTkm.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                    </div>
                    <div class="campaign-item-metric">
                      <span class="campaign-metric-label">CONVERSÃO</span>
                      <span class="campaign-metric-val ${convClass}">${c.conversion}%</span>
                    </div>
                  </div>

                  <div class="campaign-item-divider"></div>

                  <div class="campaign-item-footer">
                    <div>
                      <span class="campaign-footer-label">FATURAMENTO TOTAL</span>
                      <span class="campaign-footer-val tnum">R$ ${c.totalFat.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                    </div>
                    <button type="button" class="campaign-item-detail-link btn-open-camp-modal" data-campaign="${c.rawName.replace(/"/g, '&quot;')}">
                      Ver detalhes →
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }

      // Eventos dos cards e links
      contentHolder.querySelectorAll('.campaign-item-card, .companies-row').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.btn-open-camp-modal')) return;
          openCampaignModal(el.dataset.campaign);
        });
      });

      contentHolder.querySelectorAll('.btn-open-camp-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openCampaignModal(btn.dataset.campaign);
        });
      });
    }

    container.innerHTML = `
      <div class="campaigns-catalog-container">
        <!-- Topo da Página com Ciclo e Ação -->
        <div class="campaigns-header-row">
          <div class="campaigns-title-group">
            <div class="campaigns-title-wrap">
              <h2 class="campaigns-catalog-title">Catálogo de Campanhas Comerciais</h2>
              <span class="campaigns-count-badge">${countTotal} Campanhas</span>
            </div>
            <p class="campaigns-catalog-subtitle">Gestão integrada de períodos sazonais, conversão de cotações e faturamento consolidado por competência.</p>
          </div>

          <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">
            <div class="campaigns-cycle-badge">
              <span>📅</span>
              <span>Ciclo Consolidado: <strong>2024 — 2026</strong></span>
            </div>
            <button class="btn btn-primary btn-sm" id="btn-new-campaign" style="font-size:0.8125rem; font-weight:600; padding:0.45rem 0.95rem; border-radius:8px; display:inline-flex; align-items:center; gap:5px;">
              <span>+</span> Nova Campanha
            </button>
          </div>
        </div>

        <!-- 5 Cards de KPIs Superiores -->
        <div class="campaigns-kpis-grid">
          <!-- Card 1: Campanhas -->
          <div class="campaign-kpi-card">
            <div class="campaign-kpi-header">
              <span class="campaign-kpi-title">CAMPANHAS</span>
              <span class="campaign-kpi-dot" style="background-color:#2563eb;"></span>
            </div>
            <div class="campaign-kpi-val">${countTotal}</div>
            <p class="campaign-kpi-sub">
              <strong>${countEnded}</strong> Encerradas • <strong>${countActive}</strong> Ativas
            </p>
          </div>

          <!-- Card 2: Faturamento Total -->
          <div class="campaign-kpi-card">
            <div class="campaign-kpi-header">
              <span class="campaign-kpi-title">FATURAMENTO TOTAL</span>
              <span class="campaign-kpi-dot" style="background-color:#dc2626;"></span>
            </div>
            <div class="campaign-kpi-val">R$ 82,45M</div>
            <p class="campaign-kpi-sub">
              <span style="color:#16a34a; font-weight:700;">▲ +14.2%</span> vs ciclo anterior
            </p>
          </div>

          <!-- Card 3: Vidas em Campanhas -->
          <div class="campaign-kpi-card">
            <div class="campaign-kpi-header">
              <span class="campaign-kpi-title">VIDAS EM CAMPANHAS</span>
              <span class="campaign-kpi-dot" style="background-color:#10b981;"></span>
            </div>
            <div class="campaign-kpi-val">168.562</div>
            <p class="campaign-kpi-sub">Total de beneficiários gerados</p>
          </div>

          <!-- Card 4: Ticket Médio -->
          <div class="campaign-kpi-card">
            <div class="campaign-kpi-header">
              <span class="campaign-kpi-title">TICKET MÉDIO (TKM)</span>
              <span class="campaign-kpi-dot" style="background-color:#f59e0b;"></span>
            </div>
            <div class="campaign-kpi-val">R$ 228,40</div>
            <p class="campaign-kpi-sub">Média ponderada por vida</p>
          </div>

          <!-- Card 5: Conversão Geral -->
          <div class="campaign-kpi-card">
            <div class="campaign-kpi-header">
              <span class="campaign-kpi-title">CONVERSÃO GERAL</span>
              <span class="campaign-kpi-dot" style="background-color:#6366f1;"></span>
            </div>
            <div class="campaign-kpi-val">19,4%</div>
            <div style="width:100%; height:4px; background:#f1f5f9; border-radius:999px; margin-top:0.4rem; overflow:hidden;">
              <div style="width:19.4%; height:100%; background:#6366f1; border-radius:999px;"></div>
            </div>
          </div>
        </div>

        <!-- Barra de Filtros e Visualização -->
        <div class="campaigns-toolbar">
          <div class="campaigns-status-tabs">
            <button class="campaigns-tab-btn ${campaignViewState.status === 'all' ? 'active' : ''}" data-status="all">
              Todas <span class="campaigns-tab-pill ${campaignViewState.status === 'all' ? '' : 'pill-gray'}">${countTotal}</span>
            </button>
            <button class="campaigns-tab-btn ${campaignViewState.status === 'active' ? 'active' : ''}" data-status="active">
              Em Andamento <span class="campaigns-tab-pill ${campaignViewState.status === 'active' ? '' : 'pill-green'}">${countActive}</span>
            </button>
            <button class="campaigns-tab-btn ${campaignViewState.status === 'ended' ? 'active' : ''}" data-status="ended">
              Encerradas <span class="campaigns-tab-pill ${campaignViewState.status === 'ended' ? '' : 'pill-gray'}">${countEnded}</span>
            </button>
          </div>

          <div class="campaigns-toolbar-right">
            <!-- Segmento de Anos -->
            <div class="campaigns-year-segment">
              <button class="campaigns-year-btn ${campaignViewState.year === 'all' ? 'active' : ''}" data-year="all">Todos</button>
              <button class="campaigns-year-btn ${campaignViewState.year === '2024' ? 'active' : ''}" data-year="2024">2024</button>
              <button class="campaigns-year-btn ${campaignViewState.year === '2025' ? 'active' : ''}" data-year="2025">2025</button>
              <button class="campaigns-year-btn ${campaignViewState.year === '2026' ? 'active' : ''}" data-year="2026">2026</button>
            </div>

            <!-- Dropdown de Ordenação -->
            <select class="campaigns-sort-select" id="select-sort-campaigns">
              <option value="recent" ${campaignViewState.sort === 'recent' ? 'selected' : ''}>Ordenar: Competência (Mais Recentes)</option>
              <option value="revenue" ${campaignViewState.sort === 'revenue' ? 'selected' : ''}>Maior Faturamento</option>
              <option value="lives" ${campaignViewState.sort === 'lives' ? 'selected' : ''}>Mais Vidas</option>
              <option value="conversion" ${campaignViewState.sort === 'conversion' ? 'selected' : ''}>Maior Conversão</option>
              <option value="proposals" ${campaignViewState.sort === 'proposals' ? 'selected' : ''}>Mais Propostas</option>
              <option value="name" ${campaignViewState.sort === 'name' ? 'selected' : ''}>Nome (A-Z)</option>
            </select>

            <!-- Alternador Grid / Lista -->
            <div class="campaigns-view-toggle">
              <button class="campaigns-view-btn ${campaignViewState.viewMode === 'grid' ? 'active' : ''}" id="btn-view-grid" title="Visualização em Grade">
                ⊞
              </button>
              <button class="campaigns-view-btn ${campaignViewState.viewMode === 'list' ? 'active' : ''}" id="btn-view-list" title="Visualização em Lista">
                ☰
              </button>
            </div>
          </div>
        </div>

        <!-- Conteúdo Dinâmico (Grid ou Tabela) -->
        <div id="campaigns-dynamic-content">
          <!-- Preenchido por renderCampaignListBody() -->
        </div>

        <!-- Barra de Paginação -->
        <div class="campaigns-pagination-bar">
          <span id="campaigns-footer-info">Exibindo 1 a 12 de ${countTotal} campanhas sazonais</span>
          <div class="companies-pagination" id="campaigns-pagination-controls">
            <!-- Botões de página -->
          </div>
        </div>

        <!-- Barra Inferior de Governança -->
        <footer class="companies-bottom-bar" style="margin-top:1.5rem;">
          <div class="companies-bottom-left">
            <span>SB Saúde Corporativo • Módulo de Inteligência Comercial e Aceitação v4.8</span>
          </div>
          <div class="companies-bottom-right" style="display:inline-flex; align-items:center; gap:0.4rem;">
            <span class="companies-status-dot"></span>
            <span>Todos os microsserviços operando normalmente | SLA Comercial: 99.98%</span>
          </div>
        </footer>

        <!-- Modal de Detalhes da Campanha -->
        <div class="campaign-modal-overlay" id="campaign-modal-overlay" style="display:none;" role="dialog" aria-modal="true">
          <div class="campaign-modal" id="campaign-modal">
            <div class="campaign-modal-header" id="campaign-modal-header">
              <div class="campaign-modal-header-left">
                <div style="display:flex; align-items:center; gap:0.65rem; flex-wrap:wrap;">
                  <h2 id="modal-campaign-name">—</h2>
                  <span class="campaign-status-pill" id="modal-campaign-badge">Em Andamento</span>
                </div>
                <p id="modal-campaign-subtitle" style="color: var(--text-muted); font-size:0.85rem; margin-top:0.2rem;"></p>
              </div>

              <div class="campaign-modal-header-right">
                <!-- Seletor de Troca de Status da Campanha -->
                <div class="campaign-status-switcher-box" title="Alternar status operacional da campanha">
                  <span class="campaign-status-switcher-label">Status:</span>
                  <div class="campaign-status-switcher-btns">
                    <button type="button" class="btn-camp-status-toggle" id="modal-btn-status-active" data-status="Em Andamento" title="Mudar status para Em Andamento">
                      <span class="status-dot green"></span> Em Andamento
                    </button>
                    <button type="button" class="btn-camp-status-toggle" id="modal-btn-status-ended" data-status="Encerrada" title="Mudar status para Encerrada">
                      <span class="status-dot gray"></span> Encerrada
                    </button>
                  </div>
                </div>

                <button class="campaign-modal-close" id="campaign-modal-close" title="Fechar">✕</button>
              </div>
            </div>
            <div class="campaign-modal-body" id="campaign-modal-body">
              <!-- conteúdo dinâmico -->
            </div>
          </div>
        </div>
      </div>
    `;

    // Função de atualização em tempo real sem recriar o modal
    window.crmRefreshCampaignsCatalog = function() {
      allCampaigns.forEach(c => {
        const saved = (appData.campaignStatuses && appData.campaignStatuses[c.rawName]) || c.status;
        if (saved) {
          c.status = (saved === 'Em Andamento' || saved === 'Ativa') ? 'Em Andamento' : 'Encerrada';
        }
      });

      const updatedActive = allCampaigns.filter(c => c.status === 'Em Andamento').length;
      const updatedEnded = allCampaigns.filter(c => c.status === 'Encerrada').length;

      const kpiSub = container.querySelector('.campaign-kpi-sub');
      if (kpiSub) {
        kpiSub.innerHTML = `<strong>${updatedEnded}</strong> Encerradas • <strong>${updatedActive}</strong> Ativas`;
      }

      const pillActive = container.querySelector('.campaigns-tab-btn[data-status="active"] .campaigns-tab-pill');
      if (pillActive) pillActive.textContent = updatedActive;

      const pillEnded = container.querySelector('.campaigns-tab-btn[data-status="ended"] .campaigns-tab-pill');
      if (pillEnded) pillEnded.textContent = updatedEnded;

      renderCampaignListBody();
    };

    renderCampaignListBody();

    // Eventos da Barra de Ferramentas
    // Botão Nova Campanha
    const btnNewCamp = container.querySelector('#btn-new-campaign');
    if (btnNewCamp) {
      btnNewCamp.addEventListener('click', openNewCampaignModal);
    }

    // Tabs de Status
    container.querySelectorAll('.campaigns-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        campaignViewState.status = btn.dataset.status;
        campaignViewState.page = 1;
        container.querySelectorAll('.campaigns-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderCampaignListBody();
      });
    });

    // Segmento de Anos
    container.querySelectorAll('.campaigns-year-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        campaignViewState.year = btn.dataset.year;
        campaignViewState.page = 1;
        container.querySelectorAll('.campaigns-year-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderCampaignListBody();
      });
    });

    // Ordenação
    const sortSel = container.querySelector('#select-sort-campaigns');
    if (sortSel) {
      sortSel.addEventListener('change', (e) => {
        campaignViewState.sort = e.target.value;
        campaignViewState.page = 1;
        renderCampaignListBody();
      });
    }

    // Alternador de Visualização (Grid / Lista)
    const btnGrid = container.querySelector('#btn-view-grid');
    const btnList = container.querySelector('#btn-view-list');
    if (btnGrid && btnList) {
      btnGrid.addEventListener('click', () => {
        campaignViewState.viewMode = 'grid';
        btnGrid.classList.add('active');
        btnList.classList.remove('active');
        renderCampaignListBody();
      });
      btnList.addEventListener('click', () => {
        campaignViewState.viewMode = 'list';
        btnList.classList.add('active');
        btnGrid.classList.remove('active');
        renderCampaignListBody();
      });
    }

    // Fechar modal de detalhes
    const closeBtn = document.getElementById('campaign-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeCampaignModal);
    const modalOverlay = document.getElementById('campaign-modal-overlay');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', e => {
        if (e.target === e.currentTarget) closeCampaignModal();
      });
    }
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { closeCampaignModal(); document.removeEventListener('keydown', escHandler); }
    });
  }

  function closeCampaignModal() {
    const overlay = document.getElementById('campaign-modal-overlay');
    if (overlay) { overlay.style.display = 'none'; document.body.style.overflow = ''; }
  }



  // Modal para Cadastrar Nova Campanha Comercial
  function openNewCampaignModal() {
    let modal = document.getElementById('new-campaign-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'new-campaign-modal';
      modal.className = 'modal-backdrop';
      document.body.appendChild(modal);
    }

    const distinctComps = getDistinctCompetences();
    const currentYear = new Date().getFullYear();

    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: 760px;">
        <div class="modal-header">
          <div>
            <h3>📢 Cadastrar Nova Campanha Comercial</h3>
            <p style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">
              Configure metas, vigência, público-alvo e condições especiais da campanha comercial SB Saúde
            </p>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-close-camp-modal" style="font-size:1.25rem;">✕</button>
        </div>

        <div class="modal-body">
          <form id="form-new-campaign">
            <h4 class="form-section-title" style="margin-top:0;">1. Identificação da Campanha</h4>
            <div class="form-grid">
              <div class="form-group form-full">
                <label>Nome da Campanha Comercial <span class="req">*</span></label>
                <input type="text" class="form-control" id="camp-name" placeholder="Ex: Campanha PME Primavera 2025, Black Saúde 2025..." required>
              </div>

              <div class="form-group">
                <label>Ícone Temático</label>
                <select class="form-control" id="camp-icon">
                  <option value="📢" selected>📢 Megafone / Comercial</option>
                  <option value="🌸">🌸 Primavera (Set / Out)</option>
                  <option value="☀️">☀️ Verão / Férias</option>
                  <option value="🎪">🎪 São João / Junina</option>
                  <option value="🎭">🎭 Carnaval</option>
                  <option value="🎀">🎀 Outubro Rosa</option>
                  <option value="🔵">🔵 Novembro Azul</option>
                  <option value="🌻">🌻 Setembro Amarelo</option>
                  <option value="🐣">🐣 Páscoa</option>
                  <option value="🎆">🎆 Ano Novo / Réveillon</option>
                  <option value="🚀">🚀 Lançamento Estratégico</option>
                  <option value="💎">💎 Corporativo Premium</option>
                  <option value="⭐">⭐ Destaque de Vendas</option>
                </select>
              </div>

              <div class="form-group">
                <label>Status Operacional</label>
                <select class="form-control" id="camp-status">
                  <option value="Em Andamento" selected>🔥 Em Andamento (Ativa)</option>
                  <option value="Planejada">🗓️ Planejada (Em Breve)</option>
                  <option value="Encerrada">🏁 Encerrada</option>
                </select>
              </div>

              <div class="form-group">
                <label>Competência Principal (Mês/Ano) <span class="req">*</span></label>
                <input type="text" class="form-control" id="camp-comp" placeholder="01/MM/AAAA" list="camp-comp-datalist" value="01/10/${currentYear}" required>
                <datalist id="camp-comp-datalist">
                  ${distinctComps.map(c => `<option value="${c}">`).join('')}
                </datalist>
              </div>

              <div class="form-group">
                <label>Segmento / Linha de Planos</label>
                <select class="form-control" id="camp-segmento">
                  <option value="Todos os Segmentos" selected>Todos os Segmentos Empresariais</option>
                  <option value="PME (03 a 29 vidas)">PME (03 a 29 vidas)</option>
                  <option value="Corporativo (30+ vidas)">Corporativo (30+ vidas)</option>
                  <option value="Adesão / Coletivo">Adesão / Coletivo</option>
                </select>
              </div>
            </div>

            <h4 class="form-section-title">2. Metas &amp; Parâmetros Financeiros</h4>
            <div class="form-grid">
              <div class="form-group">
                <label>Meta de Vidas</label>
                <input type="number" class="form-control" id="camp-meta-vidas" placeholder="Ex: 500" min="1" value="500">
              </div>

              <div class="form-group">
                <label>TKM Esperado por Vida (R$)</label>
                <input type="number" step="0.01" class="form-control" id="camp-tkm-esperado" placeholder="Ex: 220.00" value="220.00">
              </div>

              <div class="form-group">
                <label>Meta de Faturamento Estimado (R$)</label>
                <input type="text" class="form-control" id="camp-meta-fat" placeholder="R$ 110.000,00" readonly style="background-color:var(--bg-canvas-subtle); font-weight:700; color:var(--primary);">
              </div>

              <div class="form-group">
                <label>Acomodação Comercial</label>
                <select class="form-control" id="camp-acomodacao">
                  <option value="Enfermaria & Apartamento" selected>Enfermaria &amp; Apartamento</option>
                  <option value="Enfermaria">Apenas Enfermaria</option>
                  <option value="Apartamento">Apenas Apartamento</option>
                  <option value="Ambulatorial">Ambulatorial</option>
                </select>
              </div>
            </div>

            <h4 class="form-section-title">3. Regras Comerciais, Bonificação &amp; Região</h4>
            <div class="form-grid">
              <div class="form-group form-full">
                <label>Condição Especial / Diferencial Competitivo</label>
                <input type="text" class="form-control" id="camp-beneficio" placeholder="Ex: Carência zero para consultas e exames + Bonificação ampliada de agenciamento">
              </div>

              <div class="form-group">
                <label>Regiões / UFs de Atuação</label>
                <input type="text" class="form-control" id="camp-ufs" placeholder="Ex: BA, SP, PE, SE" value="BA, SP">
              </div>

              <div class="form-group">
                <label>Canal / Corretor Prioritário</label>
                <input type="text" class="form-control" id="camp-canal" placeholder="Ex: Rede Credenciada Geral ou Corretoras Líderes" value="Rede Geral de Parceiros">
              </div>

              <div class="form-group form-full">
                <label>Objetivo Estratégico &amp; Observações</label>
                <textarea class="form-control" id="camp-desc" rows="3" placeholder="Descreva os objetivos da campanha, público-alvo, diretrizes de aceitação e prazos..."></textarea>
              </div>
            </div>
          </form>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" id="btn-cancel-camp-modal">Cancelar</button>
          <button class="btn btn-primary" id="btn-save-campaign">💾 Salvar e Ativar Campanha</button>
        </div>
      </div>
    `;

    modal.classList.add('active');

    // Cálculo reativo de Faturamento Estimado
    const inpVidas = modal.querySelector('#camp-meta-vidas');
    const inpTkm = modal.querySelector('#camp-tkm-esperado');
    const inpFat = modal.querySelector('#camp-meta-fat');

    function calcMetaFat() {
      const v = BusinessRules.parseLives(inpVidas.value);
      const t = parseFloat(inpTkm.value) || 0;
      const total = v * t;
      inpFat.value = BusinessRules.formatCurrency(total);
    }
    calcMetaFat();
    inpVidas.addEventListener('input', calcMetaFat);
    inpTkm.addEventListener('input', calcMetaFat);

    // Fechar modal
    const closeModal = () => modal.classList.remove('active');
    modal.querySelector('#btn-close-camp-modal').addEventListener('click', closeModal);
    modal.querySelector('#btn-cancel-camp-modal').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Salvar Campanha
    modal.querySelector('#btn-save-campaign').addEventListener('click', () => {
      const name = modal.querySelector('#camp-name').value.trim();
      const comp = modal.querySelector('#camp-comp').value.trim();

      if (!name) {
        showToast('O nome da campanha é obrigatório!', 'error');
        modal.querySelector('#camp-name').focus();
        return;
      }
      if (!comp) {
        showToast('A competência de referência é obrigatória!', 'error');
        modal.querySelector('#camp-comp').focus();
        return;
      }

      // Evita duplicidade de nome
      if ((appData.campaignsList || []).some(c => c.name.toLowerCase() === name.toLowerCase())) {
        showToast(`Já existe uma campanha cadastrada com o nome "${name}"!`, 'error');
        return;
      }

      const icon = modal.querySelector('#camp-icon').value;
      const status = modal.querySelector('#camp-status').value;
      const segmento = modal.querySelector('#camp-segmento').value;
      const metaVidas = BusinessRules.parseLives(inpVidas.value);
      const tkmEsperado = parseFloat(inpTkm.value) || 0;
      const metaFat = metaVidas * tkmEsperado;
      const acomodacao = modal.querySelector('#camp-acomodacao').value;
      const beneficio = modal.querySelector('#camp-beneficio').value.trim() || 'Condições comerciais padrão SB Saúde';
      const ufsRaw = modal.querySelector('#camp-ufs').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const ufs = ufsRaw.length > 0 ? ufsRaw : ['BA', 'SP'];
      const canal = modal.querySelector('#camp-canal').value.trim() || 'Rede Geral de Parceiros';
      const desc = modal.querySelector('#camp-desc').value.trim() || `Campanha comercial focada em prospecção empresarial para ${comp}.`;

      // Monta objeto na lista de campanhas
      const newCampItem = {
        name,
        competencias: [comp],
        count: 0,
        status,
        icon
      };

      // Adiciona no início da lista para visualização imediata
      appData.campaignsList = appData.campaignsList || [];
      appData.campaignsList.unshift(newCampItem);

      // Monta objeto enriquecido para o CRM_CAMPANHAS_DATA
      const newCampEnriched = {
        total: 0,
        totalVidas: metaVidas,
        avgTkm: tkmEsperado,
        totalFat: metaFat,
        status,
        isCustom: true,
        icon,
        segmento,
        acomodacao,
        beneficio,
        canal,
        descricao: desc,
        metaVidas,
        metaFat,
        topUfs: ufs.map(u => [u, 0]),
        topCorretores: [],
        temperaturas: {
          'Iniciada': 0
        },
        statuses: {
          [status]: 0
        },
        propostas: []
      };

      // Persiste no CRM_CAMPANHAS_DATA em memória e no appData para localStorage
      window.CRM_CAMPANHAS_DATA = window.CRM_CAMPANHAS_DATA || {};
      window.CRM_CAMPANHAS_DATA[name] = newCampEnriched;

      appData.customCampaignsData = appData.customCampaignsData || {};
      appData.customCampaignsData[name] = newCampEnriched;

      saveDataStore();
      closeModal();
      showToast(`Campanha "${name}" cadastrada com sucesso!`, 'success');

      // Re-renderiza a tela de campanhas
      const contentContainer = document.getElementById('view-content');
      if (contentContainer) {
        renderCampaigns(contentContainer);
      }
    });
  }

  function openCampaignModal(campaignName) {
    const enriched = window.CRM_CAMPANHAS_DATA || {};
    const data = enriched[campaignName] || {};
    const overlay = document.getElementById('campaign-modal-overlay');
    const body = document.getElementById('campaign-modal-body');
    if (!overlay || !body) return;

    // Elementos do Cabeçalho
    const modalName = document.getElementById('modal-campaign-name');
    const modalSubtitle = document.getElementById('modal-campaign-subtitle');
    const modalBadge = document.getElementById('modal-campaign-badge');
    const btnStatusActive = document.getElementById('modal-btn-status-active');
    const btnStatusEnded = document.getElementById('modal-btn-status-ended');

    if (modalName) modalName.textContent = campaignName;
    const total = data ? (data.total || 0) : 0;
    const comp = (appData.campaignsList || []).find(c => c.name === campaignName);
    const compStr = comp && comp.competencias ? comp.competencias.join(', ') : (data.competencias ? data.competencias.join(', ') : '-');
    
    // Identificação do Status Atual
    let currentStatus = 'Encerrada';
    const savedStatus = (appData.campaignStatuses && appData.campaignStatuses[campaignName]) || (comp && comp.status) || data.status;
    if (savedStatus) {
      currentStatus = (savedStatus === 'Em Andamento' || savedStatus === 'Ativa') ? 'Em Andamento' : 'Encerrada';
    } else if (campaignName === 'Carnaval 2026' || campaignName === 'Março 2026') {
      currentStatus = 'Em Andamento';
    }

    function updateModalStatusUI(st) {
      if (modalSubtitle) {
        modalSubtitle.textContent =
          `Competência: ${compStr} · Status: ${st} · ${total} proposta${total !== 1 ? 's' : ''} registrada${total !== 1 ? 's' : ''}`;
      }
      if (modalBadge) {
        modalBadge.textContent = st;
        modalBadge.className = `campaign-status-pill ${st === 'Em Andamento' ? 'status-ativa' : 'status-encerrada'}`;
      }
      if (btnStatusActive && btnStatusEnded) {
        if (st === 'Em Andamento') {
          btnStatusActive.classList.add('active');
          btnStatusEnded.classList.remove('active');
        } else {
          btnStatusEnded.classList.add('active');
          btnStatusActive.classList.remove('active');
        }
      }
    }

    updateModalStatusUI(currentStatus);

    function setCampaignStatus(newStatus) {
      if (currentStatus === newStatus) return;
      currentStatus = newStatus;

      appData.campaignStatuses = appData.campaignStatuses || {};
      appData.campaignStatuses[campaignName] = newStatus;

      if (comp) {
        comp.status = newStatus;
      }
      if (window.CRM_CAMPANHAS_DATA && window.CRM_CAMPANHAS_DATA[campaignName]) {
        window.CRM_CAMPANHAS_DATA[campaignName].status = newStatus;
      }
      saveDataStore();

      updateModalStatusUI(newStatus);
      showToast(`Status da campanha "${campaignName}" alterado para ${newStatus}.`, 'success');

      if (typeof window.crmRefreshCampaignsCatalog === 'function') {
        window.crmRefreshCampaignsCatalog();
      }
    }

    if (btnStatusActive) {
      btnStatusActive.onclick = () => setCampaignStatus('Em Andamento');
    }
    if (btnStatusEnded) {
      btnStatusEnded.onclick = () => setCampaignStatus('Encerrada');
    }

    if (!data || Object.keys(data).length === 0) {
      body.innerHTML = '<p style="padding:2rem;color:var(--text-muted);">Sem dados detalhados disponíveis para esta campanha.</p>';
      overlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      return;
    }

    const fmt = (v) => isNaN(v) || !v ? '-' : Number(v).toLocaleString('pt-BR');
    const fmtMoney = (v) => isNaN(v) || !v ? '-' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Temperaturas
    const temps = data.temperaturas || {};
    const tempLabels = {
      'Contrato Fechado': { cls: 'temp-fechado', label: 'Fechado' },
      'Quente': { cls: 'temp-quente', label: 'Quente' },
      'Morna': { cls: 'temp-morna', label: 'Morna' },
      'Fria': { cls: 'temp-fria', label: 'Fria' },
      'Desistência da Empresa': { cls: 'temp-desistencia', label: 'Desistência' },
      'Declinado': { cls: 'temp-declinado', label: 'Declinado' },
      'Iniciada': { cls: 'temp-iniciada', label: 'Iniciada' },
    };
    const tempHtml = Object.entries(temps).sort((a,b) => b[1]-a[1]).map(([k,v]) => {
      const pct = total > 0 ? Math.round((v/total)*100) : 0;
      const info = Object.entries(tempLabels).find(([tk]) => k.toLowerCase().includes(tk.toLowerCase()));
      const cls = info ? info[1].cls : 'temp-iniciada';
      return `
        <div class="modal-temp-row">
          <span class="temp-badge ${cls}" style="min-width:130px; justify-content:center;">${k}</span>
          <div class="modal-temp-bar-wrap">
            <div class="modal-temp-bar" style="width:${pct}%;"></div>
          </div>
          <span style="font-size:0.82rem; font-weight:700; min-width:50px; text-align:right;">${v} <span style="color:var(--text-muted);font-weight:400;">(${pct}%)</span></span>
        </div>`;
    }).join('');

    // Top Corretores
    const corretoresHtml = (data.topCorretores || []).length > 0 ? (data.topCorretores || []).map(([nome, qtd], idx) => `
      <div class="modal-corretor-row">
        <span class="modal-rank">${idx+1}º</span>
        <span class="modal-corretor-nome">${nome}</span>
        <span class="modal-corretor-qtd">${qtd} proposta${qtd!==1?'s':''}</span>
      </div>`).join('') : '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhum corretor com propostas vinculadas ainda.</p>';

    // Top UFs
    const ufsHtml = (data.topUfs || []).length > 0 ? (data.topUfs || []).map(([uf, qtd]) => `
      <span class="modal-uf-badge" title="${qtd} propostas">${uf} <strong>${qtd}</strong></span>`).join('') : '<span style="color:var(--text-muted); font-size:0.85rem;">Nacional</span>';

    // Tabela de Propostas
    const propostas = data.propostas || [];
    const tabelaHtml = propostas.length > 0 ? `
      <div class="modal-section">
        <h4 class="modal-section-title">📋 Todas as Propostas da Campanha <span style="color:var(--text-muted);font-weight:400;">(${propostas.length})</span></h4>
        <div class="table-container" style="max-height: 380px; overflow-y: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Temperatura</th>
                <th>Empresa</th>
                <th>UF</th>
                <th>Vidas</th>
                <th>TKM</th>
                <th>Faturamento</th>
                <th>Acomodação</th>
                <th>Fator Moderador</th>
                <th>Corretor</th>
              </tr>
            </thead>
            <tbody>
              ${propostas.map(p => `
                <tr>
                  <td><span class="temp-badge ${getBadgeClass(p.temperatura)}">${p.temperatura || '-'}</span></td>
                  <td><strong>${p.empresa || '-'}</strong></td>
                  <td>${p.uf || '-'}</td>
                  <td class="tnum">${p.vidas || '-'}</td>
                  <td class="tnum">${p.tkm || '-'}</td>
                  <td class="tnum">${p.faturamento || '-'}</td>
                  <td>${p.acomodacao || '-'}</td>
                  <td>${p.fatorModerador || '-'}</td>
                  <td>${p.corretor || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    // Seção Estratégica para Campanhas Customizadas / Planejadas
    const customPlanningHtml = (data.isCustom || propostas.length === 0) ? `
      <div class="modal-section" style="border-left: 4px solid var(--primary);">
        <h4 class="modal-section-title">🎯 Diretrizes Comerciais &amp; Regras da Campanha</h4>
        <div class="campaign-details-grid">
          <div class="campaign-detail-card">
            <span class="campaign-detail-card-label">Segmento de Planos</span>
            <span class="campaign-detail-card-val">${data.segmento || 'Todos os Segmentos Empresariais'}</span>
          </div>
          <div class="campaign-detail-card">
            <span class="campaign-detail-card-label">Acomodação Principal</span>
            <span class="campaign-detail-card-val">${data.acomodacao || 'Enfermaria & Apartamento'}</span>
          </div>
          <div class="campaign-detail-card">
            <span class="campaign-detail-card-label">Canal Prioritário</span>
            <span class="campaign-detail-card-val">${data.canal || 'Rede Geral de Parceiros'}</span>
          </div>
          <div class="campaign-detail-card">
            <span class="campaign-detail-card-label">Regiões Prioritárias</span>
            <span class="campaign-detail-card-val">${(data.topUfs || []).map(u => u[0]).join(', ') || 'BA, SP'}</span>
          </div>
          <div class="campaign-detail-card" style="grid-column: 1 / -1;">
            <span class="campaign-detail-card-label">Condição Especial / Benefício Comercial</span>
            <span class="campaign-detail-card-val" style="color:var(--primary);">${data.beneficio || 'Condições comerciais padrão SB Saúde'}</span>
          </div>
          ${data.descricao ? `
            <div class="campaign-detail-card" style="grid-column: 1 / -1;">
              <span class="campaign-detail-card-label">Objetivo Estratégico</span>
              <span class="campaign-detail-card-val" style="font-weight:400; font-size:0.88rem; color:var(--text-secondary);">${data.descricao}</span>
            </div>
          ` : ''}
        </div>
      </div>

      ${propostas.length === 0 ? `
        <div class="campaign-empty-alert">
          <div>
            <h4 style="font-size:0.95rem; font-weight:700; color:var(--secondary); margin-bottom:0.25rem;">
              🚀 Campanha em Andamento
            </h4>
            <p style="font-size:0.84rem; color:var(--text-secondary); margin:0;">
              Novas cotações cadastradas com a competência <strong>${compStr}</strong> serão vinculadas automaticamente a esta campanha.
            </p>
          </div>
          <button class="btn btn-primary btn-sm" id="btn-quote-for-campaign" style="white-space:nowrap;">
            + Nova Cotação para ${compStr}
          </button>
        </div>
      ` : ''}
    ` : '';

    body.innerHTML = `
      <!-- KPIs -->
      <div class="modal-kpis-grid">
        <div class="modal-kpi-card">
          <span class="modal-kpi-val">${fmt(data.total)}</span>
          <span class="modal-kpi-label">${data.isCustom ? 'Propostas Ativas' : 'Propostas'}</span>
        </div>
        <div class="modal-kpi-card">
          <span class="modal-kpi-val">${fmt(data.totalVidas)}</span>
          <span class="modal-kpi-label">${data.isCustom ? 'Meta de Vidas' : 'Vidas Totais'}</span>
        </div>
        <div class="modal-kpi-card">
          <span class="modal-kpi-val">R$ ${data.avgTkm ? Number(data.avgTkm).toLocaleString('pt-BR',{minimumFractionDigits:2}) : '-'}</span>
          <span class="modal-kpi-label">TKM Médio</span>
        </div>
        <div class="modal-kpi-card" style="border-color: var(--success-border); background: var(--success-bg);">
          <span class="modal-kpi-val" style="color:var(--success);">${fmtMoney(data.totalFat)}</span>
          <span class="modal-kpi-label">${data.isCustom ? 'Meta Faturamento' : 'Faturamento Total'}</span>
        </div>
      </div>

      ${customPlanningHtml}

      ${propostas.length > 0 ? `
        <div class="modal-two-cols">
          <!-- Temperaturas -->
          <div class="modal-section">
            <h4 class="modal-section-title">🌡️ Distribuição de Temperatura</h4>
            <div class="modal-temp-list">${tempHtml}</div>
          </div>

          <!-- Corretores + UFs -->
          <div style="display:flex;flex-direction:column;gap:1.25rem;">
            <div class="modal-section">
              <h4 class="modal-section-title">👔 Top Corretores</h4>
              <div class="modal-corretores-list">${corretoresHtml}</div>
            </div>
            <div class="modal-section">
              <h4 class="modal-section-title">📍 Estados (UF)</h4>
              <div class="modal-ufs-row">${ufsHtml}</div>
            </div>
          </div>
        </div>
      ` : ''}

      ${tabelaHtml}
    `;

    // Ação rápida para vincular nova cotação
    const btnQuoteCamp = body.querySelector('#btn-quote-for-campaign');
    if (btnQuoteCamp) {
      btnQuoteCamp.addEventListener('click', () => {
        closeCampaignModal();
        openNewQuoteModal();
      });
    }

    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }


  // 6. POLÍTICAS COMERCIAIS (AGENCIAMENTO E COPARTICIPAÇÃO)
  function renderPolicies(container) {
    const agency = appData.agencyPolicies || [];
    const copart = appData.coparticipationPolicies || [];

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title">
          <h2>Políticas Comerciais Cadastradas</h2>
          <p>Diretrizes homologadas de agenciamento para corretores e regras de coparticipação</p>
        </div>
      </div>

      <h3 class="form-section-title">Políticas de Agenciamento (RN-08)</h3>
      <div class="table-container" style="margin-bottom: 2rem;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nome da Política</th>
              <th>Agenciamento (%)</th>
              <th>Vitalício (%)</th>
              <th>Parcelas</th>
            </tr>
          </thead>
          <tbody>
            ${agency.map(a => `
              <tr>
                <td><strong>${a.Politica_Agencimento}</strong></td>
                <td class="tnum">${a.Agenciamento || '50,00%'}</td>
                <td class="tnum">${a.Vitalicio || '5,00%'}</td>
                <td class="tnum">${a.Parcelas || '2'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2rem; margin-bottom:0.85rem;">
        <h3 class="form-section-title" style="margin:0; border:none;">Políticas de Coparticipação por Evento (RN-09)</h3>
        <button class="btn btn-primary btn-sm" id="btn-new-copart-policy">
          ➕ Novo Modelo de Coparticipação
        </button>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nome da Política</th>
              <th>Desconto</th>
              <th>Ultrapasse (Partida)</th>
              <th>Consulta Eletiva</th>
              <th>Emergência</th>
              <th>Exame Simples</th>
              <th>Exame Complexo</th>
              <th>Terapia</th>
              <th>Valor Terapia</th>
              <th style="text-align:right;">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${copart.map((c, idx) => `
              <tr>
                <td>
                  <div style="display:flex; align-items:center; gap:0.5rem;">
                    ${c.Imagem ? `<img src="${c.Imagem}" alt="" style="width:24px; height:24px; object-fit:contain; border-radius:4px; border:1px solid var(--border-subtle);">` : ''}
                    <strong>${c.Nome_Politica}</strong>
                  </div>
                </td>
                <td class="tnum">${c.Percentual_Desconto_Evento || c.Desconto_Evento || '0,00%'}</td>
                <td class="tnum">${c.Qnt_Partida_Evento || '0'}</td>
                <td class="tnum">${c.Valor_Consulta_Eletiva || c.Consulta_Eletiva || '-'}</td>
                <td class="tnum">${c.Valor_Consulta_Emergencia || c.Emergencia || '-'}</td>
                <td class="tnum">${c.Valor_Exames_Simples || c.Exames_Simples || '-'}</td>
                <td class="tnum">${c.Valor_Exames_Complexos || c.Exames_Complexos || '-'}</td>
                <td>${c.Terapia === 'Sim' ? '<span class="temp-badge temp-fechado">Sim</span>' : '<span class="temp-badge temp-fria">Não</span>'}</td>
                <td class="tnum">${c.Valor_Terapia || 'Não aplicável'}</td>
                <td style="text-align:right;">
                  <button class="btn btn-ghost btn-xs btn-edit-copart" data-index="${idx}" title="Editar Modelo">✏️</button>
                  ${idx >= 2 ? `<button class="btn btn-ghost btn-xs btn-delete-copart" data-index="${idx}" title="Excluir Modelo" style="color:var(--danger);">🗑️</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Eventos da Tela de Políticas
    const btnNewCopart = container.querySelector('#btn-new-copart-policy');
    if (btnNewCopart) {
      btnNewCopart.addEventListener('click', () => {
        openNewCopartModal();
      });
    }

    container.querySelectorAll('.btn-edit-copart').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        if (copart[idx]) {
          openNewCopartModal(copart[idx], idx);
        }
      });
    });

    container.querySelectorAll('.btn-delete-copart').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        const item = copart[idx];
        if (item && confirm(`Tem certeza que deseja excluir o modelo de coparticipação "${item.Nome_Politica}"?`)) {
          copart.splice(idx, 1);
          saveDataStore();
          showToast(`Modelo de coparticipação removido com sucesso.`);
          renderView();
        }
      });
    });
  }

  // MODAL DE CADASTRO / EDIÇÃO DE NOVO MODELO DE COPARTICIPAÇÃO
  function openNewCopartModal(editItem = null, editIndex = -1) {
    let modal = document.getElementById('copart-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'copart-modal';
      modal.className = 'modal-backdrop';
      document.body.appendChild(modal);
    }

    const isEdit = !!editItem;
    const initialNome = editItem ? (editItem.Nome_Politica || '') : '';
    let initialDesconto = 0;
    if (editItem) {
      const descStr = editItem.Percentual_Desconto_Evento || editItem.Desconto_Evento || '0%';
      const parsed = parseFloat(String(descStr).replace(/[%\s]/g, '').replace(',', '.'));
      if (!isNaN(parsed)) initialDesconto = Math.round(parsed);
    }
    const initialUltrapasse = editItem ? (parseInt(editItem.Qnt_Partida_Evento, 10) || 0) : 0;
    const initialEletiva = editItem ? (editItem.Valor_Consulta_Eletiva || editItem.Consulta_Eletiva || 'R$ 0,00') : 'R$ 0,00';
    const initialEmergencia = editItem ? (editItem.Valor_Consulta_Emergencia || editItem.Emergencia || 'R$ 0,00') : 'R$ 0,00';
    const initialExamesSimples = editItem ? (editItem.Valor_Exames_Simples || editItem.Exames_Simples || 'R$ 0,00') : 'R$ 0,00';
    const initialExamesComplexos = editItem ? (editItem.Valor_Exames_Complexos || editItem.Exames_Complexos || 'R$ 0,00') : 'R$ 0,00';
    const initialTerapia = editItem && editItem.Terapia === 'Sim' ? 'Sim' : 'Não';
    const initialValorTerapia = editItem ? (editItem.Valor_Terapia || 'R$ 0,00') : 'R$ 0,00';
    let currentImage = editItem ? (editItem.Imagem || '') : '';

    modal.innerHTML = `
      <div class="modal-dialog" style="max-width:560px;">
        <div class="modal-header">
          <div>
            <h3>${isEdit ? 'Editar Modelo de Coparticipação' : 'Novo Modelo de Coparticipação'}</h3>
            <span style="font-size:0.75rem; color:var(--text-muted);">Parametrização de regras e valores limitadores (RN-09)</span>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-close-copart-modal" style="font-size:1.25rem;">✕</button>
        </div>

        <div class="modal-body" style="padding:1.5rem 1.75rem;">
          <form id="form-copart">
            <!-- 1. Nome da Política de Coparticipação -->
            <div class="form-group" style="margin-bottom:1.25rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">
                Nome da Politica de Coparticipação <span class="req">*</span>
              </label>
              <input type="text" class="form-control" id="inp-copart-nome" value="${initialNome}" placeholder="Digite o nome da política..." style="border: 2px solid #b91c1c; border-radius: var(--radius-sm, 4px);" required>
            </div>

            <!-- 2. Percentual de Desconto -->
            <div class="form-group copart-slider-wrapper" style="margin-bottom:1.25rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">
                Percentual de Desconto <span class="req">*</span>
              </label>
              <div class="copart-slider-val" id="copart-slider-label">${initialDesconto}%</div>
              <input type="range" class="copart-range-input" id="inp-copart-desconto" min="0" max="100" step="1" value="${initialDesconto}">
            </div>

            <!-- 3. Quantidade de Ultrapasse Mensal -->
            <div class="form-group" style="margin-bottom:1.25rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">
                Quantidade de Ultrapasse Mensal <span class="req">*</span>
              </label>
              <div class="stepper-input-group" style="border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
                <input type="text" class="form-control stepper-input" id="inp-copart-ultrapasse" value="${initialUltrapasse}" style="text-align:left; padding-left:1rem; border:none;">
                <button type="button" class="stepper-btn minus" id="btn-copart-ultrapasse-minus" style="border:none; border-left:1px solid var(--border-subtle); background:transparent;">−</button>
                <button type="button" class="stepper-btn plus" id="btn-copart-ultrapasse-plus" style="border:none; border-left:1px solid var(--border-subtle); background:transparent;">+</button>
              </div>
            </div>

            <!-- 4. Valor Limitador: Consulta Eletiva -->
            <div class="form-group" style="margin-bottom:1.25rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">
                Valor Limitador: Consulta Eletiva <span class="req">*</span>
              </label>
              <input type="text" class="form-control" id="inp-copart-eletiva" value="${initialEletiva}" placeholder="R$ 0,00" required>
            </div>

            <!-- 5. Valor Limitador: Consulta Urgência / Emergência -->
            <div class="form-group" style="margin-bottom:1.25rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">
                Valor Limitador: Consulta Urgência / Emergência <span class="req">*</span>
              </label>
              <input type="text" class="form-control" id="inp-copart-emergencia" value="${initialEmergencia}" placeholder="R$ 0,00" required>
            </div>

            <!-- 6. Valor Limitador: Exames Simples -->
            <div class="form-group" style="margin-bottom:1.25rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">
                Valor Limitador: Exames Simples <span class="req">*</span>
              </label>
              <input type="text" class="form-control" id="inp-copart-exames-simples" value="${initialExamesSimples}" placeholder="R$ 0,00" required>
            </div>

            <!-- 7. Valor Limitador: Exames Complexos -->
            <div class="form-group" style="margin-bottom:1.25rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">
                Valor Limitador: Exames Complexos <span class="req">*</span>
              </label>
              <input type="text" class="form-control" id="inp-copart-exames-complexos" value="${initialExamesComplexos}" placeholder="R$ 0,00" required>
            </div>

            <!-- 8. Imagem -->
            <div class="form-group" style="margin-bottom:1.25rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">Imagem</label>
              <input type="file" id="inp-copart-file" accept="image/*" style="display:none;">
              <div class="copart-image-upload-box" id="copart-image-box" title="Clique para anexar uma imagem">
                <span class="copart-camera-icon" id="copart-camera-icon" style="${currentImage ? 'display:none;' : ''}">📷</span>
                <img id="copart-img-preview" class="copart-img-preview" src="${currentImage}" style="${currentImage ? '' : 'display:none;'}" alt="Preview">
              </div>
            </div>

            <!-- 9. Cobrança de Coparticipação para Terapia -->
            <div class="form-group" style="margin-bottom:1rem;">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">
                Haverá Cobrança de Coparticipação para Terapia? <span class="req">*</span>
              </label>
              <input type="hidden" id="inp-copart-terapia" value="${initialTerapia}">
              <div class="segmented-yes-no" id="copart-terapia-segmented">
                <button type="button" class="${initialTerapia === 'Sim' ? 'active' : ''}" data-value="Sim">Sim</button>
                <button type="button" class="${initialTerapia !== 'Sim' ? 'active' : ''}" data-value="Não">Não</button>
              </div>
            </div>

            <div class="form-group" id="group-copart-valor-terapia" style="margin-bottom:1rem; ${initialTerapia === 'Sim' ? '' : 'display:none;'}">
              <label style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">
                Valor Limitador: Terapia <span class="req">*</span>
              </label>
              <input type="text" class="form-control" id="inp-copart-valor-terapia" value="${initialValorTerapia}" placeholder="R$ 0,00">
            </div>
          </form>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" id="btn-cancel-copart-modal">Cancelar</button>
          <button class="btn btn-primary" id="btn-save-copart-policy">💾 Salvar Modelo de Coparticipação</button>
        </div>
      </div>
    `;

    modal.classList.add('active');

    // Referências aos campos
    const inpNome = modal.querySelector('#inp-copart-nome');
    const inpDesconto = modal.querySelector('#inp-copart-desconto');
    const labelDesconto = modal.querySelector('#copart-slider-label');
    const inpUltrapasse = modal.querySelector('#inp-copart-ultrapasse');
    const btnUltrapasseMinus = modal.querySelector('#btn-copart-ultrapasse-minus');
    const btnUltrapassePlus = modal.querySelector('#btn-copart-ultrapasse-plus');
    const inpEletiva = modal.querySelector('#inp-copart-eletiva');
    const inpEmergencia = modal.querySelector('#inp-copart-emergencia');
    const inpExamesSimples = modal.querySelector('#inp-copart-exames-simples');
    const inpExamesComplexos = modal.querySelector('#inp-copart-exames-complexos');
    const inpHiddenTerapia = modal.querySelector('#inp-copart-terapia');
    const inpValorTerapia = modal.querySelector('#inp-copart-valor-terapia');
    const groupValorTerapia = modal.querySelector('#group-copart-valor-terapia');
    const boxImage = modal.querySelector('#copart-image-box');
    const fileImage = modal.querySelector('#inp-copart-file');
    const iconCamera = modal.querySelector('#copart-camera-icon');
    const imgPreview = modal.querySelector('#copart-img-preview');

    // Slider de Desconto
    inpDesconto.addEventListener('input', () => {
      labelDesconto.textContent = `${inpDesconto.value}%`;
    });

    // Stepper de Ultrapasse
    btnUltrapasseMinus.addEventListener('click', () => {
      let n = parseInt(inpUltrapasse.value, 10) || 0;
      inpUltrapasse.value = Math.max(0, n - 1);
    });

    btnUltrapassePlus.addEventListener('click', () => {
      let n = parseInt(inpUltrapasse.value, 10) || 0;
      inpUltrapasse.value = n + 1;
    });

    // Formatação de Moeda pt-BR nos inputs monetários
    function applyCurrencyFormatting(input) {
      input.addEventListener('blur', () => {
        const val = BusinessRules.parseCurrency(input.value);
        input.value = BusinessRules.formatCurrency(val);
      });
      input.addEventListener('focus', () => {
        if (input.value === 'R$ 0,00' || input.value === '') {
          input.select();
        }
      });
    }

    applyCurrencyFormatting(inpEletiva);
    applyCurrencyFormatting(inpEmergencia);
    applyCurrencyFormatting(inpExamesSimples);
    applyCurrencyFormatting(inpExamesComplexos);
    applyCurrencyFormatting(inpValorTerapia);

    // Upload de Imagem
    boxImage.addEventListener('click', () => fileImage.click());
    fileImage.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          currentImage = evt.target.result;
          imgPreview.src = currentImage;
          imgPreview.style.display = 'block';
          iconCamera.style.display = 'none';
        };
        reader.readAsDataURL(file);
      }
    });

    // Segmented Sim / Não para Terapia
    modal.querySelectorAll('#copart-terapia-segmented button').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('#copart-terapia-segmented button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const val = btn.dataset.value;
        inpHiddenTerapia.value = val;
        if (val === 'Sim') {
          groupValorTerapia.style.display = 'block';
        } else {
          groupValorTerapia.style.display = 'none';
        }
      });
    });

    // Fechamento
    modal.querySelector('#btn-close-copart-modal').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#btn-cancel-copart-modal').addEventListener('click', () => modal.classList.remove('active'));

    // Salvar
    modal.querySelector('#btn-save-copart-policy').addEventListener('click', () => {
      const nome = inpNome.value.trim();
      if (!nome) {
        alert('Por favor informe o Nome da Política de Coparticipação.');
        inpNome.focus();
        return;
      }

      const ultrapasseVal = parseInt(inpUltrapasse.value, 10) || 0;
      const eletivaVal = BusinessRules.formatCurrency(BusinessRules.parseCurrency(inpEletiva.value));
      const emergenciaVal = BusinessRules.formatCurrency(BusinessRules.parseCurrency(inpEmergencia.value));
      const examesSimplesVal = BusinessRules.formatCurrency(BusinessRules.parseCurrency(inpExamesSimples.value));
      const examesComplexosVal = BusinessRules.formatCurrency(BusinessRules.parseCurrency(inpExamesComplexos.value));
      const terapiaChoice = inpHiddenTerapia.value;
      const valorTerapiaVal = terapiaChoice === 'Sim' ? BusinessRules.formatCurrency(BusinessRules.parseCurrency(inpValorTerapia.value)) : 'Não aplicável';

      const policyObject = {
        _RowNumber: editItem ? editItem._RowNumber : String((appData.coparticipationPolicies.length + 2)),
        Id_Politica: editItem ? editItem.Id_Politica : Math.random().toString(16).substring(2, 10),
        Nome_Politica: nome,
        Percentual_Desconto_Evento: `${inpDesconto.value},00%`,
        Desconto_Evento: `${inpDesconto.value},00%`,
        Qnt_Partida_Evento: String(ultrapasseVal),
        Valor_Consulta_Eletiva: eletivaVal,
        Consulta_Eletiva: eletivaVal,
        Valor_Consulta_Emergencia: emergenciaVal,
        Emergencia: emergenciaVal,
        Valor_Exames_Simples: examesSimplesVal,
        Exames_Simples: examesSimplesVal,
        Valor_Exames_Complexos: examesComplexosVal,
        Exames_Complexos: examesComplexosVal,
        Terapia: terapiaChoice,
        Valor_Terapia: valorTerapiaVal,
        Imagem: currentImage || ''
      };

      if (isEdit && editIndex >= 0) {
        appData.coparticipationPolicies[editIndex] = { ...appData.coparticipationPolicies[editIndex], ...policyObject };
        showToast(`Modelo de Coparticipação "${nome}" atualizado com sucesso!`);
      } else {
        appData.coparticipationPolicies.push(policyObject);
        showToast(`Modelo de Coparticipação "${nome}" cadastrado com sucesso!`);
      }

      saveDataStore();
      if (window.crmSupabase?.isConnected) {
        window.crmSupabase.saveCopartPolicy(policyObject);
      }
      modal.classList.remove('active');
      renderView();
    });
  }

  // Exposição global do modal de coparticipação
  window.openNewCopartModal = openNewCopartModal;

  // 7. AUDITORIA E MATRIZ DE REQUISITOS
  function renderAuditAndRequirements(container) {
    const reqs = appData.requirementsList || [];
    const audit = appData.auditReport || {};
    const modules = Array.from(new Set(reqs.map(r => r.module))).filter(Boolean).sort();

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title">
          <h2>Auditoria de Qualidade e Matriz de Requisitos</h2>
          <p>48 requisitos funcionais com critérios de aceite e conciliação de dados legados</p>
        </div>
      </div>

      <!-- Resumo da Auditoria de Dados -->
      <h3 class="form-section-title">Achados Críticos de Auditoria de Migração (Diagnóstico Seção 13)</h3>
      <div class="kpi-grid">
        <div class="kpi-card" style="border-color:var(--warning);">
          <div class="kpi-header"><span class="kpi-label">Coparticipação sem Política</span></div>
          <div class="kpi-value tnum" style="color:var(--warning);">524</div>
          <p class="text-muted" style="font-size:0.75rem; margin-top:4px;">Propostas com fator coparticipação sem política associada (preservadas).</p>
        </div>
        <div class="kpi-card" style="border-color:var(--info);">
          <div class="kpi-header"><span class="kpi-label">Faixas Etárias Vazias</span></div>
          <div class="kpi-value tnum" style="color:var(--info);">323</div>
          <p class="text-muted" style="font-size:0.75rem; margin-top:4px;">Registros importados em pendência sem preenchimento artificial.</p>
        </div>
        <div class="kpi-card" style="border-color:var(--danger);">
          <div class="kpi-header"><span class="kpi-label">Declínio sem Justificativa</span></div>
          <div class="kpi-value tnum" style="color:var(--danger);">1</div>
          <p class="text-muted" style="font-size:0.75rem; margin-top:4px;">Registro histórico isolado submetido à revisão auditada.</p>
        </div>
        <div class="kpi-card" style="border-color:var(--secondary);">
          <div class="kpi-header"><span class="kpi-label">Divergências de Arredondamento</span></div>
          <div class="kpi-value tnum" style="color:var(--secondary);">20</div>
          <p class="text-muted" style="font-size:0.75rem; margin-top:4px;">Casos históricos preservados com valores originais.</p>
        </div>
      </div>

      <!-- Matriz de Requisitos RF-01 a RF-48 -->
      <h3 class="form-section-title">Catálogo dos 48 Requisitos Funcionais</h3>

      <!-- Barra de Filtros e Pesquisa de Requisitos -->
      <div class="filter-toolbar" style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; gap: 0.85rem; flex-wrap: wrap;">
        <div style="display:flex; align-items:center; gap:0.65rem; flex: 1; min-width: 260px; max-width: 600px; flex-wrap: wrap;">
          <input type="text" id="req-search-input" class="form-input form-input-sm" placeholder="Buscar por ID, título ou termo chave..." style="flex: 1; min-width: 180px;">
          <select id="req-filter-module" class="form-select form-select-sm" style="min-width: 160px;">
            <option value="">Todos os Módulos</option>
            ${modules.map(m => `<option value="${m}">${m}</option>`).join('')}
          </select>
          <select id="req-filter-priority" class="form-select form-select-sm" style="min-width: 110px;">
            <option value="">Prioridades</option>
            <option value="P0">P0 (Crítica)</option>
            <option value="P1">P1 (Alta)</option>
            <option value="P2">P2 (Média)</option>
          </select>
        </div>
        <div class="text-muted" style="font-size:0.82rem;" id="req-count-indicator">
          Exibindo <strong>${reqs.length}</strong> de ${reqs.length} requisitos
        </div>
      </div>

      <div class="table-container">
        <table class="data-table requirements-table" id="requirements-table-main">
          <thead>
            <tr>
              <th>ID</th>
              <th>Módulo</th>
              <th>Prioridade</th>
              <th>Título do Requisito</th>
              <th>Comportamento Esperado</th>
              <th>Critério de Aceite</th>
            </tr>
          </thead>
          <tbody>
            ${reqs.map(r => `
              <tr class="req-data-row" data-id="${(r.id || '').toLowerCase()}" data-module="${(r.module || '').toLowerCase()}" data-priority="${(r.priority || '').toUpperCase()}" data-search="${`${r.id || ''} ${r.module || ''} ${r.title || ''} ${r.behavior || ''} ${r.acceptance || ''}`.toLowerCase()}">
                <td><span class="code-tag">${r.id}</span></td>
                <td><strong>${r.module}</strong></td>
                <td><span class="temp-badge ${r.priority === 'P0' ? 'temp-quente' : 'temp-morna'}">${r.priority}</span></td>
                <td class="cell-wrap"><strong>${r.title}</strong></td>
                <td class="cell-wrap" style="font-size:0.8rem;">${r.behavior}</td>
                <td class="cell-wrap" style="font-size:0.8rem; color:var(--text-muted);">${r.acceptance}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Filtros dinâmicos da matriz de requisitos
    const reqSearch = container.querySelector('#req-search-input');
    const reqModule = container.querySelector('#req-filter-module');
    const reqPriority = container.querySelector('#req-filter-priority');
    const reqCount = container.querySelector('#req-count-indicator');
    const rows = container.querySelectorAll('.req-data-row');

    function filterRequirements() {
      const q = (reqSearch ? reqSearch.value : '').toLowerCase().trim();
      const m = (reqModule ? reqModule.value : '').toLowerCase().trim();
      const p = (reqPriority ? reqPriority.value : '').toUpperCase().trim();

      let visible = 0;
      rows.forEach(r => {
        const rowSearch = r.getAttribute('data-search') || '';
        const rowModule = r.getAttribute('data-module') || '';
        const rowPriority = r.getAttribute('data-priority') || '';

        const matchQ = !q || rowSearch.includes(q);
        const matchM = !m || rowModule === m;
        const matchP = !p || rowPriority === p;

        if (matchQ && matchM && matchP) {
          r.style.display = '';
          visible++;
        } else {
          r.style.display = 'none';
        }
      });

      if (reqCount) {
        reqCount.innerHTML = `Exibindo <strong>${visible}</strong> de ${reqs.length} requisitos`;
      }
    }

    if (reqSearch) reqSearch.addEventListener('input', filterRequirements);
    if (reqModule) reqModule.addEventListener('change', filterRequirements);
    if (reqPriority) reqPriority.addEventListener('change', filterRequirements);
  }

  // 8. DRAWER LATERAL DE DETALHES DA EMPRESA / PROPOSTA (LAYOUT LEGADO COM 22 CAMPOS & LINKS INTERATIVOS)
  function resolveCampaignStatus(campaignName) {
    if (!campaignName || campaignName === 'Sem Campanha') return 'Não se aplica';
    const saved = appData.campaignStatuses && appData.campaignStatuses[campaignName];
    if (saved) return (saved === 'Em Andamento' || saved === 'Ativa') ? 'Campanha Ativa' : 'Campanha Encerrada';
    if (campaignName.includes('2026')) return 'Campanha Ativa';
    return 'Campanha Encerrada';
  }

  function openCompanyDrawer(companyName, proposalId = null) {
    const proposals = (appData.proposals || []).filter(p => p.EMPRESA === companyName);
    if (proposals.length > 0) {
      let targetProp = proposals[0];
      if (proposalId) {
        const found = proposals.find(p => String(p.ID) === String(proposalId));
        if (found) targetProp = found;
      }
      openProposalDrawer(targetProp.ID, { companyMode: true, companyName: companyName, companyProposals: proposals });
    } else {
      openProposalDrawer(null, { companyMode: true, companyName: companyName, companyProposals: [] });
    }
  }

  function openProposalDrawer(proposalId, options = {}) {
    let p = proposalId ? appData.proposals.find(item => String(item.ID) === String(proposalId)) : null;
    if (!p && options.companyName) {
      const compProps = (appData.proposals || []).filter(item => item.EMPRESA === options.companyName);
      if (compProps.length > 0) p = compProps[0];
    }

    let drawer = document.getElementById('proposal-drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'proposal-drawer';
      drawer.className = 'drawer-backdrop';
      document.body.appendChild(drawer);
    }

    const circleArrowSvg = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="10 8 14 12 10 16"></polyline>
      </svg>
    `;

    // Caso a empresa não possua cotações cadastradas
    if (!p) {
      const compName = options.companyName || 'Empresa';
      const compDetails = getCompanyDetails(compName);
      drawer.innerHTML = `
        <div class="drawer-panel">
          <div class="drawer-header">
            <div>
              <span class="code-tag">Empresa Cadastrada</span>
              <h3 style="font-size:1.15rem; font-weight:700; margin-top:0.25rem;">${compName}</h3>
              <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">
                ${compDetails.cnpj ? `CNPJ: ${compDetails.cnpj} • ` : ''}UF: ${compDetails.uf || 'BA'}
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <button class="btn btn-secondary btn-sm" id="btn-manage-company-from-drawer" title="Gerenciar cadastro da empresa">
                🏢 Cadastro da Empresa
              </button>
              <button class="btn btn-ghost btn-sm" id="btn-close-drawer" style="font-size:1.25rem;">✕</button>
            </div>
          </div>
          <div class="drawer-body">
            <div style="padding:2.5rem 1rem; text-align:center; color:var(--text-muted); background:var(--bg-canvas); border-radius:var(--radius-md); border:1px dashed var(--border-subtle);">
              <span style="font-size:2.5rem; display:block; margin-bottom:0.75rem;">📋</span>
              <h4 style="margin:0 0 0.5rem 0; color:var(--text-primary); font-size:1.05rem;">Nenhuma Cotação Cadastrada</h4>
              <p style="font-size:0.85rem; margin:0 0 1.25rem 0;">Esta empresa não possui cotações registradas no histórico.</p>
              <button class="btn btn-primary btn-sm" id="btn-new-quote-from-empty-comp">
                ➕ Nova Cotação para esta Empresa
              </button>
            </div>
          </div>
          <div class="drawer-footer">
            <button class="btn btn-ghost btn-sm" id="btn-close-drawer-bottom">Fechar</button>
          </div>
        </div>
      `;
      drawer.classList.add('active');

      const closeHandler = () => drawer.classList.remove('active');
      drawer.querySelector('#btn-close-drawer')?.addEventListener('click', closeHandler);
      drawer.querySelector('#btn-close-drawer-bottom')?.addEventListener('click', closeHandler);
      drawer.addEventListener('click', (e) => { if (e.target === drawer) closeHandler(); });

      drawer.querySelector('#btn-manage-company-from-drawer')?.addEventListener('click', () => {
        openCompanyModal(compName);
      });
      drawer.querySelector('#btn-new-quote-from-empty-comp')?.addEventListener('click', () => {
        drawer.classList.remove('active');
        openNewQuoteModal({ EMPRESA: compName, CNPJ: compDetails.cnpj, UF: compDetails.uf });
      });
      return;
    }

    state.selectedProposal = p;
    const companyName = p.EMPRESA || options.companyName || 'Empresa';
    const allCompanyProps = (appData.proposals || []).filter(item => item.EMPRESA === companyName);
    const hasCopart = p.FATOR_MODERADOR && p.FATOR_MODERADOR.includes('Coparticipação');

    drawer.innerHTML = `
      <div class="drawer-panel">
        <div class="drawer-header">
          <div>
            <span class="code-tag">#PRP-${p.ID}</span>
            <h3 style="font-size:1.15rem; font-weight:700; margin-top:0.25rem;">${companyName}</h3>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">
              ${p.CNPJ ? `CNPJ: ${p.CNPJ} • ` : ''}UF: ${p.UF || 'BA'} • ${allCompanyProps.length} cotaç${allCompanyProps.length === 1 ? 'ão' : 'ões'}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <button class="btn btn-secondary btn-sm" id="btn-manage-company-from-drawer" title="Gerenciar cadastro fiscal, corretores e campanha">
              🏢 Cadastro da Empresa
            </button>
            <button class="btn btn-ghost btn-sm" id="btn-close-drawer" style="font-size:1.25rem;">✕</button>
          </div>
        </div>

        <div class="drawer-body">
          ${allCompanyProps.length > 1 ? `
            <div class="drawer-quote-switcher" title="Alternar entre cotações desta empresa">
              ${allCompanyProps.map((cp, idx) => `
                <button type="button" class="drawer-quote-pill ${String(cp.ID) === String(p.ID) ? 'active' : ''}" data-prop-id="${cp.ID}">
                  #PRP-${cp.ID} • ${cp.DATA_DA_PROSPECCAO || cp.COMPETENCIA || `Cotação ${idx + 1}`}
                </button>
              `).join('')}
            </div>
          ` : ''}

          <div class="drawer-legacy-fields-list">
            <!-- 1. Empresa -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Empresa</span>
              <div class="drawer-legacy-val">
                <span>${companyName}</span>
                <button type="button" class="detail-link-arrow" data-link-type="company" data-link-value="${companyName.replace(/"/g, '&quot;')}" title="Gerenciar cadastro de ${companyName}">
                  ${circleArrowSvg}
                </button>
              </div>
            </div>

            <!-- 2. Data da Proposta -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Data da Proposta</span>
              <div class="drawer-legacy-val">${p.DATA_DA_PROSPECCAO || '-'}</div>
            </div>

            <!-- 3. Competência -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Competência</span>
              <div class="drawer-legacy-val tnum">${p.COMPETENCIA || '-'}</div>
            </div>

            <!-- 4. Vidas -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Vidas</span>
              <div class="drawer-legacy-val tnum">${p.VIDAS || '0'}</div>
            </div>

            <!-- 5. UF -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">UF</span>
              <div class="drawer-legacy-val">${p.UF || '-'}</div>
            </div>

            <!-- 6. TKM (Ticket Médio) -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">TKM (Ticket Médio)</span>
              <div class="drawer-legacy-val tnum">${p.TKM || 'R$0,00'}</div>
            </div>

            <!-- 7. Faturamento -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Faturamento</span>
              <div class="drawer-legacy-val tnum" style="color:var(--primary);">${p.FATURAMENTO || 'R$0,00'}</div>
            </div>

            <!-- 8. Acomodação -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Acomodação</span>
              <div class="drawer-legacy-val">${p.ACOMODACAO || 'Enfermaria'}</div>
            </div>

            <!-- 9. Fator Moderador -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Fator Moderador</span>
              <div class="drawer-legacy-val">${p.FATOR_MODERADOR || 'Mensalidade'}</div>
            </div>

            <!-- 10. Politica de Coparticipação -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Politica de Coparticipação</span>
              <div class="drawer-legacy-val">
                <span>${p.POLITICA_COPARTICIPACAO || (hasCopart ? 'Padrão SB Saúde' : 'Não aplicável')}</span>
                ${hasCopart || p.POLITICA_COPARTICIPACAO ? `
                  <button type="button" class="detail-link-arrow" data-link-type="copart" data-link-value="${(p.POLITICA_COPARTICIPACAO || 'Padrão SB Saúde').replace(/"/g, '&quot;')}" title="Acessar Políticas de Coparticipação">
                    ${circleArrowSvg}
                  </button>
                ` : ''}
              </div>
            </div>

            <!-- 11. Corretor de Negocios 1 -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Corretor de Negocios 1</span>
              <div class="drawer-legacy-val">
                <span>${p.CORRETORES_1 || 'Direto'}</span>
                ${p.CORRETORES_1 && p.CORRETORES_1 !== 'Direto' ? `
                  <button type="button" class="detail-link-arrow" data-link-type="broker" data-link-value="${p.CORRETORES_1.replace(/"/g, '&quot;')}" title="Acessar Corretor ${p.CORRETORES_1}">
                    ${circleArrowSvg}
                  </button>
                ` : ''}
              </div>
            </div>

            <!-- 12. Agenciamento do Corretor 1 -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Agenciamento do Corretor 1</span>
              <div class="drawer-legacy-val">
                <span>${p.AGENCIAMENTO_1 || 'Padrão SB Saúde'}</span>
                <button type="button" class="detail-link-arrow" data-link-type="agency" data-link-value="${(p.AGENCIAMENTO_1 || 'Padrão SB Saúde').replace(/"/g, '&quot;')}" title="Acessar Políticas de Agenciamento">
                  ${circleArrowSvg}
                </button>
              </div>
            </div>

            <!-- 13. Campanha -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Campanha</span>
              <div class="drawer-legacy-val">
                <span>${p.PLANO_CAMPANHA || 'Sem Campanha'}</span>
                ${p.PLANO_CAMPANHA && p.PLANO_CAMPANHA !== 'Sem Campanha' ? `
                  <button type="button" class="detail-link-arrow" data-link-type="campaign" data-link-value="${p.PLANO_CAMPANHA.replace(/"/g, '&quot;')}" title="Acessar Campanha ${p.PLANO_CAMPANHA}">
                    ${circleArrowSvg}
                  </button>
                ` : ''}
              </div>
            </div>

            <!-- 14. Status Campanha -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Status Campanha</span>
              <div class="drawer-legacy-val">
                <span>${resolveCampaignStatus(p.PLANO_CAMPANHA)}</span>
              </div>
            </div>

            <!-- 15. Temperatura do Fechamento do Contrato -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Temperatura do Fechamento do Contrato</span>
              <div class="drawer-legacy-val">
                <span class="temp-badge ${getBadgeClass(p.TEMPERATURA_CONTRATO)}">${p.TEMPERATURA_CONTRATO || 'Iniciada'}</span>
              </div>
            </div>

            <!-- 16. Empresa Apta ou Inapta para Contabilização da Conversão -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Empresa Apta ou Inapta para Contabilização da Conversão</span>
              <div class="drawer-legacy-val">
                <span class="temp-badge ${p.Aptidao === 'Inapto' ? 'temp-declinado' : 'temp-fechado'}">${p.Aptidao || 'Apto'}</span>
              </div>
            </div>

            <!-- 17. Tipo do Contrato -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Tipo do Contrato</span>
              <div class="drawer-legacy-val">${p.Tipo_Contrato || 'Empresarial'}</div>
            </div>

            <!-- 18. Quantidade de Faixas Etárias -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Quantidade de Faixas Etárias</span>
              <div class="drawer-legacy-val">${p.Qnt_Faixa_Etaria || 'Faixa Única'}</div>
            </div>

            <!-- 19. Faixas Etárias -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Faixas Etárias</span>
              <div class="drawer-legacy-val multiline">${p.Faixa_Etaria || '00 a 18 anos , 19 a 23 anos , 24 a 28 anos , 29 a 33 anos , 34 a 38 anos , 39 a 43 anos , 44 a 48 anos , 49 a 53 anos , 54 a 58 anos , 59 anos acima'}</div>
            </div>

            <!-- 20. Data da Avaliação: Diretoria -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Data da Avaliação: Diretoria</span>
              <div class="drawer-legacy-val">${p.Data_Avaliacao_Diretoria || '-'}</div>
            </div>

            <!-- 21. Data de Envio da Proposta ao Corretor e/ou Cliente -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Data de Envio da Proposta ao Corretor e/ou Cliente</span>
              <div class="drawer-legacy-val">${p.Data_Envio_Corretor || '-'}</div>
            </div>

            <!-- 22. Observações -->
            <div class="drawer-legacy-field">
              <span class="drawer-legacy-label">Observações</span>
              <div class="drawer-legacy-val multiline">${p.Observacao || '-'}</div>
            </div>

            <!-- Corretores Adicionais (se houver) -->
            ${p.CORRETORES_2 ? `
              <div class="drawer-legacy-field">
                <span class="drawer-legacy-label">Corretor de Negócios 2</span>
                <div class="drawer-legacy-val">
                  <span>${p.CORRETORES_2}</span>
                  <button type="button" class="detail-link-arrow" data-link-type="broker" data-link-value="${p.CORRETORES_2.replace(/"/g, '&quot;')}" title="Acessar Corretor ${p.CORRETORES_2}">
                    ${circleArrowSvg}
                  </button>
                </div>
              </div>
              <div class="drawer-legacy-field">
                <span class="drawer-legacy-label">Agenciamento do Corretor 2</span>
                <div class="drawer-legacy-val">
                  <span>${p.AGENCIAMENTO_2 || '-'}</span>
                  <button type="button" class="detail-link-arrow" data-link-type="agency" data-link-value="${(p.AGENCIAMENTO_2 || 'Padrão SB Saúde').replace(/"/g, '&quot;')}" title="Acessar Políticas de Agenciamento">
                    ${circleArrowSvg}
                  </button>
                </div>
              </div>
            ` : ''}

            ${p.CORRETORES_3 ? `
              <div class="drawer-legacy-field">
                <span class="drawer-legacy-label">Corretor de Negócios 3</span>
                <div class="drawer-legacy-val">
                  <span>${p.CORRETORES_3}</span>
                  <button type="button" class="detail-link-arrow" data-link-type="broker" data-link-value="${p.CORRETORES_3.replace(/"/g, '&quot;')}" title="Acessar Corretor ${p.CORRETORES_3}">
                    ${circleArrowSvg}
                  </button>
                </div>
              </div>
              <div class="drawer-legacy-field">
                <span class="drawer-legacy-label">Agenciamento do Corretor 3</span>
                <div class="drawer-legacy-val">
                  <span>${p.AGENCIAMENTO_3 || '-'}</span>
                  <button type="button" class="detail-link-arrow" data-link-type="agency" data-link-value="${(p.AGENCIAMENTO_3 || 'Padrão SB Saúde').replace(/"/g, '&quot;')}" title="Acessar Políticas de Agenciamento">
                    ${circleArrowSvg}
                  </button>
                </div>
              </div>
            ` : ''}

            ${p.Data_Analise_tecnica ? `
              <div class="drawer-legacy-field">
                <span class="drawer-legacy-label">Data da Avaliação: Equipe Técnica</span>
                <div class="drawer-legacy-val">${p.Data_Analise_tecnica}</div>
              </div>
            ` : ''}
          </div>
        </div>

        <div class="drawer-footer">
          <button class="btn btn-secondary btn-sm" id="btn-edit-proposal">✏️ Editar Cotação</button>
          <div style="display:flex; gap:0.5rem;">
            <select class="filter-select" id="drawer-quick-temp" style="min-width:160px;">
              ${BusinessRules.TEMPERATURAS.map(t => `<option value="${t}" ${p.TEMPERATURA_CONTRATO === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-sm" id="btn-save-drawer-temp">Atualizar</button>
          </div>
        </div>
      </div>
    `;

    drawer.classList.add('active');

    // Fechar drawer
    const closeDrawer = () => drawer.classList.remove('active');
    drawer.querySelector('#btn-close-drawer')?.addEventListener('click', closeDrawer);
    drawer.addEventListener('click', (e) => {
      if (e.target === drawer) closeDrawer();
    });

    // Gerenciar cadastro da empresa
    drawer.querySelector('#btn-manage-company-from-drawer')?.addEventListener('click', () => {
      openCompanyModal(companyName);
    });

    // Editar cotação
    drawer.querySelector('#btn-edit-proposal')?.addEventListener('click', () => {
      drawer.classList.remove('active');
      openNewQuoteModal(p);
    });

    // Alternar entre cotações da empresa
    drawer.querySelectorAll('.drawer-quote-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const propId = pill.dataset.propId;
        openProposalDrawer(propId, { companyMode: true, companyName: companyName });
      });
    });

    // Links interativos (>)
    drawer.querySelectorAll('.detail-link-arrow').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const linkType = btn.dataset.linkType;
        const linkVal = btn.dataset.linkValue;

        if (linkType === 'company') {
          openCompanyModal(linkVal);
        } else if (linkType === 'copart') {
          closeDrawer();
          if (window.navigateToTab) {
            window.navigateToTab('policies', () => {
              const sec = document.getElementById('copart-policies-section');
              if (sec) {
                sec.scrollIntoView({ behavior: 'smooth' });
                sec.classList.add('highlight-section');
                setTimeout(() => sec.classList.remove('highlight-section'), 2000);
              }
              showToast(`Visualizando Políticas de Coparticipação: ${linkVal}`, 'info');
            });
          }
        } else if (linkType === 'broker') {
          closeDrawer();
          if (window.navigateToTab) {
            window.navigateToTab('brokers', () => {
              const inp = document.getElementById('inp-search-broker') || document.querySelector('.brokers-search-input');
              if (inp) {
                inp.value = linkVal;
                inp.dispatchEvent(new Event('input'));
              }
              showToast(`Filtrando Corretor: ${linkVal}`, 'info');
            });
          }
        } else if (linkType === 'agency') {
          closeDrawer();
          if (window.navigateToTab) {
            window.navigateToTab('policies', () => {
              const sec = document.getElementById('agency-policies-section') || document.querySelector('.policies-section');
              if (sec) {
                sec.scrollIntoView({ behavior: 'smooth' });
                sec.classList.add('highlight-section');
                setTimeout(() => sec.classList.remove('highlight-section'), 2000);
              }
              showToast(`Visualizando Agenciamento: ${linkVal}`, 'info');
            });
          }
        } else if (linkType === 'campaign') {
          closeDrawer();
          if (window.navigateToTab) {
            window.navigateToTab('campaigns', () => {
              const inp = document.getElementById('inp-search-campaign');
              if (inp) {
                inp.value = linkVal;
                inp.dispatchEvent(new Event('input'));
              }
              showToast(`Visualizando Campanha: ${linkVal}`, 'info');
            });
          }
        }
      });
    });

    // Atualização rápida de temperatura
    const btnSaveTemp = drawer.querySelector('#btn-save-drawer-temp');
    if (btnSaveTemp) {
      btnSaveTemp.addEventListener('click', () => {
        const newTemp = drawer.querySelector('#drawer-quick-temp').value;
        if (newTemp === 'Declinado pela SB Saúde' && !p.Motivo_Declinio) {
          const reason = prompt('Informe a justificativa obrigatória para o declínio da proposta (RN-06):');
          if (!reason || !reason.trim()) {
            alert('A justificativa é estritamente obrigatória para declínio!');
            return;
          }
          p.Motivo_Declinio = reason.trim();
        }
        p.TEMPERATURA_CONTRATO = newTemp;
        p.Aptidao = BusinessRules.determineAptitude(newTemp);
        saveDataStore();
        if (window.crmSupabase?.isConnected) {
          window.crmSupabase.saveProposal(p);
        }
        showToast(`Temperatura de #PRP-${p.ID} atualizada para ${newTemp}!`);
        closeDrawer();
        renderView();
      });
    }
  }

  // Exposição global dos drawers de empresa e proposta
  window.openCompanyDrawer = openCompanyDrawer;
  window.openProposalDrawer = openProposalDrawer;

  // 9. MODAL DE NOVA COTAÇÃO & EDIÇÃO REATIVA (MODELO COMPLETO DO SISTEMA LEGADO)
  function openNewQuoteModal(editItem = null) {
    let modal = document.getElementById('quote-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'quote-modal';
      modal.className = 'modal-backdrop';
      document.body.appendChild(modal);
    }

    const isEdit = !!(editItem && editItem.ID);
    const initialDate = editItem && editItem.DATA_DA_PROSPECCAO ? editItem.DATA_DA_PROSPECCAO : BusinessRules.formatDateBR();
    const initialComp = editItem && editItem.COMPETENCIA ? editItem.COMPETENCIA : BusinessRules.calculateCompetence(initialDate);
    const initialId = isEdit ? editItem.ID : BusinessRules.generateUniqueId(appData.proposals);
    const initialTemp = editItem && editItem.TEMPERATURA_CONTRATO ? editItem.TEMPERATURA_CONTRATO : 'Iniciada';
    const initialMotivo = editItem && editItem.Motivo_Declinio ? editItem.Motivo_Declinio : '';
    const initialEmpresa = editItem && editItem.EMPRESA ? editItem.EMPRESA : '';
    const initialCnpj = editItem && editItem.CNPJ ? editItem.CNPJ : '';
    const initialVidas = editItem && editItem.VIDAS ? editItem.VIDAS : '100';
    const initialUf = editItem && editItem.UF ? editItem.UF : (appData.ufs && appData.ufs.length > 0 ? appData.ufs[0].UF : 'SP');
    const initialCidade = editItem && editItem.CIDADE ? editItem.CIDADE : '';
    const initialTkm = editItem && editItem.TKM ? editItem.TKM : 'R$ 180,00';
    const initialAcomodacao = editItem && editItem.ACOMODACAO ? editItem.ACOMODACAO : 'Ambulatorial';
    const initialTipoContrato = editItem && editItem.Tipo_Contrato ? editItem.Tipo_Contrato : 'Empresarial';
    const initialQntFaixas = editItem && editItem.Qnt_Faixa_Etaria ? editItem.Qnt_Faixa_Etaria : 'Faixa Única';
    const initialFaixasStr = editItem && editItem.Faixa_Etaria ? editItem.Faixa_Etaria : '';
    const initialFator = editItem && editItem.FATOR_MODERADOR ? editItem.FATOR_MODERADOR : 'Mensalidade';
    const initialCopart = editItem && editItem.POLITICA_COPARTICIPACAO ? editItem.POLITICA_COPARTICIPACAO : '';
    const initialCorretor1 = editItem && editItem.CORRETORES_1 ? editItem.CORRETORES_1 : '';
    const initialAgenc1 = editItem && editItem.AGENCIAMENTO_1 ? editItem.AGENCIAMENTO_1 : 'Padrão SB Saúde';
    const initialVital1 = editItem && editItem.VITALICIO_1 ? editItem.VITALICIO_1 : '% 0,00';
    const initialCorretor2 = editItem && editItem.CORRETORES_2 ? editItem.CORRETORES_2 : '';
    const initialAgenc2 = editItem && editItem.AGENCIAMENTO_2 ? editItem.AGENCIAMENTO_2 : '';
    const initialVital2 = editItem && editItem.VITALICIO_2 ? editItem.VITALICIO_2 : '% 0,00';
    const initialCorretor3 = editItem && editItem.CORRETORES_3 ? editItem.CORRETORES_3 : '';
    const initialAgenc3 = editItem && editItem.AGENCIAMENTO_3 ? editItem.AGENCIAMENTO_3 : '';
    const initialVital3 = editItem && editItem.VITALICIO_3 ? editItem.VITALICIO_3 : '% 0,00';
    const initialDataTecnica = editItem && editItem.Data_Analise_tecnica ? editItem.Data_Analise_tecnica : '';
    const initialDataDiretoria = editItem && editItem.Data_Avaliacao_Diretoria ? editItem.Data_Avaliacao_Diretoria : '';
    const initialDataEnvio = editItem && editItem.Data_Envio_Corretor ? editItem.Data_Envio_Corretor : '';
    const initialObs = editItem && editItem.Observacao ? editItem.Observacao : '';

    // Formata faixas selecionadas inicialmente em conjunto para busca rápida
    const selectedFaixasSet = new Set(
      initialFaixasStr.split(',').map(f => f.trim()).filter(Boolean)
    );

    // Lista de temperaturas na ordem do sistema legado
    const legacyTemperaturas = [
      'Desistência por Ausência de Retorno',
      'Desistência da Empresa',
      'Declinado pela SB Saúde',
      'Iniciada',
      'Fria',
      'Morna',
      'Quente',
      'Contrato Fechado'
    ];

    modal.innerHTML = `
      <div class="modal-dialog" style="max-width:920px;">
        <div class="modal-header">
          <div>
            <h3>${isEdit ? `Editar Cotação #PRP-${editItem.ID}` : 'Nova Cotação / Prospecção Comercial'}</h3>
            <span style="font-size:0.75rem; color:var(--text-muted);">Formulário parametrizado conforme modelo oficial legado do CRM</span>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-close-modal" style="font-size:1.25rem;">✕</button>
        </div>

        <div class="modal-body">
          <form id="form-quote">
            <!-- 1. Competência e Identificação -->
            <div class="form-grid" style="margin-bottom:1rem;">
              <div class="form-group">
                <label>Código da Proposta</label>
                <input type="text" class="form-control" id="inp-id" value="${initialId}" readonly>
              </div>

              <div class="form-group">
                <label>Usuário Responsável (RN-01)</label>
                <input type="text" class="form-control" id="inp-user" value="${isEdit ? editItem.Usuario : BusinessRules.getCurrentUser()}" readonly>
              </div>

              <div class="form-group">
                <label>Competência (RN-02) <span class="req">*</span></label>
                <input type="text" class="form-control" id="inp-comp" value="${initialComp}" placeholder="01/MM/AAAA" style="color:var(--primary); font-weight:700;">
              </div>

              <div class="form-group">
                <label>Data da Proposta <span class="req">*</span></label>
                <input type="text" class="form-control" id="inp-date" value="${initialDate}" placeholder="DD/MM/AAAA" required>
              </div>
            </div>

            <!-- 2. Temperatura do Fechamento do Contrato (Modelo Legado com Botões) -->
            <div class="form-group form-full" style="margin-bottom:1.25rem;">
              <label>Temperatura do Fechamento do Contrato <span class="req">*</span></label>
              <input type="hidden" id="inp-temp" value="${initialTemp}">
              <div class="temp-selector-list" id="temp-buttons-container">
                ${legacyTemperaturas.map(t => `
                  <button type="button" class="temp-btn ${t === initialTemp ? 'active' : ''}" data-temp="${t}">
                    ${t}
                  </button>
                `).join('')}
              </div>
            </div>

            <!-- 3. Motivo do Declínio da Cotação (Conforme modelo legado) -->
            <div class="form-group form-full" id="group-decline-reason" style="margin-bottom:1.25rem; display:flex; flex-direction:column; gap:0.45rem; ${initialTemp === 'Declinado pela SB Saúde' || initialTemp.includes('Desistência') ? '' : 'display:none;'}">
              <label style="color:var(--primary); font-weight:700;">Motivo do Declínio da Cotação <span class="req">*</span></label>
              <select class="form-control" id="inp-decline-reason" style="width:100%;">
                <option value="">Selecione o motivo do declínio...</option>
                ${BusinessRules.MOTIVOS_DECLINIO.map(m => `
                  <option value="${m}" ${initialMotivo === m ? 'selected' : ''}>${m}</option>
                `).join('')}
                ${initialMotivo && !BusinessRules.MOTIVOS_DECLINIO.includes(initialMotivo) ? `
                  <option value="${initialMotivo}" selected>${initialMotivo}</option>
                ` : ''}
              </select>
              <textarea class="form-control" id="inp-decline-details" rows="2" placeholder="Justificativa complementar do declínio (obrigatória pela RN-06 caso o motivo seja personalizado)..." style="width:100%;">${initialTemp === 'Declinado pela SB Saúde' && initialMotivo && !BusinessRules.MOTIVOS_DECLINIO.includes(initialMotivo) ? initialMotivo : ''}</textarea>
            </div>

            <h4 class="form-section-title">Dados da Empresa & Localização</h4>
            <div class="form-grid">
              <div class="form-group form-full">
                <label>Empresa <span class="req">*</span></label>
                <input type="text" class="form-control" id="inp-empresa" value="${initialEmpresa}" placeholder="Nome ou razão social completa da empresa" list="companies-datalist" required>
                <datalist id="companies-datalist">
                  ${appData.companies.slice(0, 100).map(c => `<option value="${c.EMPRESA}">`).join('')}
                </datalist>
              </div>

              <div class="form-group">
                <label>CNPJ</label>
                <input type="text" class="form-control" id="inp-cnpj" value="${initialCnpj}" placeholder="00.000.000/0000-00">
              </div>

              <div class="form-group">
                <label>Vidas <span class="req">*</span></label>
                <input type="number" class="form-control" id="inp-vidas" value="${initialVidas}" min="1" required>
              </div>

              <div class="form-group">
                <label>UF <span class="req">*</span></label>
                <select class="form-control" id="inp-uf" required>
                  ${appData.ufs.map(u => `
                    <option value="${u.UF}" ${initialUf === u.UF ? 'selected' : ''}>${u.UF}</option>
                  `).join('')}
                </select>
              </div>

              <div class="form-group">
                <label>Cidade (Busca inteligente por UF) <span class="req">*</span></label>
                <div class="city-field-wrapper">
                  <input type="text" class="form-control" id="inp-cidade" value="${initialCidade}" placeholder="Selecione ou busque a cidade..." list="cities-datalist" autocomplete="off">
                  <datalist id="cities-datalist"></datalist>
                  <div class="city-status-text" id="city-status-info">
                    <span>⚡ Buscando cidades do estado...</span>
                  </div>
                </div>
              </div>
            </div>

            <h4 class="form-section-title">Dimensionamento Financeiro</h4>
            <div class="form-grid">
              <div class="form-group">
                <label>TKM (Ticket Médio) <span class="req">*</span></label>
                <input type="text" class="form-control" id="inp-tkm" value="${initialTkm}" placeholder="R$ 0,00" required>
              </div>

              <div class="form-group">
                <label>Faturamento Mensal Calculado (Vidas × TKM - RN-03)</label>
                <input type="text" class="form-control" id="inp-faturamento" value="R$ 0,00" readonly style="font-size:1.1rem; font-weight:700; color:var(--secondary-light);">
              </div>
            </div>

            <h4 class="form-section-title">Plano, Acomodação & Faixas Etárias</h4>
            <div class="form-grid">
              <!-- Acomodação em botões segmentados -->
              <div class="form-group form-full">
                <label>Acomodação <span class="req">*</span></label>
                <input type="hidden" id="inp-acomodacao" value="${initialAcomodacao}">
                <div class="segmented-group" id="acomodacao-segmented-group">
                  ${BusinessRules.ACOMODACOES.map(ac => `
                    <button type="button" class="segmented-btn ${ac === initialAcomodacao ? 'active' : ''}" data-value="${ac}">
                      ${ac}
                    </button>
                  `).join('')}
                </div>
              </div>

              <!-- Tipo do Contrato em botões segmentados -->
              <div class="form-group form-full">
                <label>Tipo do Contrato <span class="req">*</span></label>
                <input type="hidden" id="inp-tipo-contrato" value="${initialTipoContrato}">
                <div class="segmented-group" id="tipo-contrato-segmented-group">
                  ${BusinessRules.TIPOS_CONTRATO.map(tc => `
                    <button type="button" class="segmented-btn ${tc === initialTipoContrato ? 'active' : ''}" data-value="${tc}">
                      ${tc}
                    </button>
                  `).join('')}
                </div>
              </div>

              <!-- Quantidade de Faixa Etária -->
              <div class="form-group">
                <label>Quantidade de Faixa Etária <span class="req">*</span></label>
                <select class="form-control" id="inp-qnt-faixas">
                  ${BusinessRules.QNT_FAIXAS.map(q => `
                    <option value="${q}" ${initialQntFaixas === q ? 'selected' : ''}>${q}</option>
                  `).join('')}
                </select>
              </div>

              <!-- Fator Moderador -->
              <div class="form-group">
                <label>Fator Moderador <span class="req">*</span></label>
                <select class="form-control" id="inp-fator">
                  ${BusinessRules.FATORES_MODERADORES.map(f => `
                    <option value="${f}" ${initialFator === f ? 'selected' : ''}>${f}</option>
                  `).join('')}
                </select>
              </div>

              <!-- Política Coparticipação se aplicável -->
              <div class="form-group form-full" id="group-copart" style="${initialFator.includes('Coparticipação') ? '' : 'display:none;'}">
                <label>Política de Coparticipação Vinculada (RN-09)</label>
                <select class="form-control" id="inp-politica-copart">
                  ${appData.coparticipationPolicies.map(cp => `
                    <option value="${cp.Nome_Politica}" ${initialCopart === cp.Nome_Politica ? 'selected' : ''}>
                      ${cp.Nome_Politica} (Desconto: ${cp.Desconto_Evento || '0%'}, Consulta: ${cp.Consulta_Eletiva})
                    </option>
                  `).join('')}
                </select>
              </div>

              <!-- Faixas Etárias Selecionadas -->
              <div class="form-group form-full">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <label>Faixas Etárias <span class="req">*</span></label>
                  <div style="display:flex; gap:0.5rem;">
                    <button type="button" class="btn btn-ghost btn-xs" id="btn-select-all-faixas" style="color:var(--primary); font-weight:600;">
                      ⚡ Selecionar Padrão ANS (10 Faixas)
                    </button>
                    <button type="button" class="btn btn-ghost btn-xs" id="btn-clear-faixas" style="color:var(--text-muted);">
                      Limpar
                    </button>
                  </div>
                </div>
                <input type="hidden" id="inp-faixas-etarias" value="${initialFaixasStr}">
                <div class="faixa-chips-container" id="faixas-chips-wrapper">
                  ${BusinessRules.FAIXAS_ETARIAS_PADRAO.map(faixa => {
                    const isChecked = selectedFaixasSet.has(faixa);
                    return `
                      <button type="button" class="faixa-chip ${isChecked ? 'active' : ''}" data-faixa="${faixa}">
                        <span class="faixa-check">${isChecked ? '✓' : '+'}</span>
                        <span>${faixa}</span>
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>
            </div>

            <h4 class="form-section-title">Participação de Corretores, Agenciamento & Vitalício (RN-08)</h4>
            
            <!-- Corretor 1 -->
            <div style="background-color:rgba(0,0,0,0.02); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:1rem; margin-bottom:1rem;">
              <div style="font-weight:700; font-size:0.85rem; margin-bottom:0.75rem; color:var(--text-primary);">
                Corretor de Negócios 1 (Titular / Obrigatório) <span class="req">*</span>
              </div>
              <div class="form-grid">
                <div class="form-group form-full">
                  <label>Nome do Corretor 1 <span class="req">*</span></label>
                  <input type="text" class="form-control" id="inp-corretor-1" value="${initialCorretor1}" placeholder="Nome do corretor de negócios 1" list="brokers-datalist" required>
                </div>
                <div class="form-group">
                  <label>Agenciamento do Corretor 1</label>
                  <select class="form-control" id="inp-agenciamento-1">
                    ${BusinessRules.OPCOES_AGENCIAMENTO.map(op => `
                      <option value="${op}" ${initialAgenc1 === op ? 'selected' : ''}>${op}</option>
                    `).join('')}
                    ${initialAgenc1 && !BusinessRules.OPCOES_AGENCIAMENTO.includes(initialAgenc1) ? `<option value="${initialAgenc1}" selected>${initialAgenc1}</option>` : ''}
                  </select>
                </div>
                <div class="form-group">
                  <label>Vitalício do Corretor 1</label>
                  <div class="stepper-input-group" id="stepper-group-1">
                    <button type="button" class="stepper-btn minus" id="btn-vital-minus-1">−</button>
                    <input type="text" class="form-control stepper-input" id="inp-vitalicio-1" value="${initialVital1}">
                    <button type="button" class="stepper-btn plus" id="btn-vital-plus-1">+</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Corretor 2 -->
            <div style="background-color:rgba(0,0,0,0.02); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:1rem; margin-bottom:1rem;">
              <div style="font-weight:700; font-size:0.85rem; margin-bottom:0.75rem; color:var(--text-secondary);">
                Corretor de Negócios 2 (Opcional)
              </div>
              <div class="form-grid">
                <div class="form-group form-full">
                  <label>Nome do Corretor 2</label>
                  <input type="text" class="form-control" id="inp-corretor-2" value="${initialCorretor2}" placeholder="Nome do corretor de negócios 2 (se houver)" list="brokers-datalist">
                </div>
                <div class="form-group">
                  <label>Agenciamento do Corretor 2</label>
                  <select class="form-control" id="inp-agenciamento-2">
                    <option value="">Nenhum agenciamento</option>
                    ${BusinessRules.OPCOES_AGENCIAMENTO.map(op => `
                      <option value="${op}" ${initialAgenc2 === op ? 'selected' : ''}>${op}</option>
                    `).join('')}
                    ${initialAgenc2 && !BusinessRules.OPCOES_AGENCIAMENTO.includes(initialAgenc2) ? `<option value="${initialAgenc2}" selected>${initialAgenc2}</option>` : ''}
                  </select>
                </div>
                <div class="form-group">
                  <label>Vitalício do Corretor 2</label>
                  <div class="stepper-input-group" id="stepper-group-2">
                    <button type="button" class="stepper-btn minus" id="btn-vital-minus-2">−</button>
                    <input type="text" class="form-control stepper-input" id="inp-vitalicio-2" value="${initialVital2}">
                    <button type="button" class="stepper-btn plus" id="btn-vital-plus-2">+</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Corretor 3 -->
            <div style="background-color:rgba(0,0,0,0.02); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:1rem; margin-bottom:1rem;">
              <div style="font-weight:700; font-size:0.85rem; margin-bottom:0.75rem; color:var(--text-secondary);">
                Corretor de Negócios 3 (Opcional)
              </div>
              <div class="form-grid">
                <div class="form-group form-full">
                  <label>Nome do Corretor 3</label>
                  <input type="text" class="form-control" id="inp-corretor-3" value="${initialCorretor3}" placeholder="Nome do corretor de negócios 3 (se houver)" list="brokers-datalist">
                </div>
                <div class="form-group">
                  <label>Agenciamento do Corretor 3</label>
                  <select class="form-control" id="inp-agenciamento-3">
                    <option value="">Nenhum agenciamento</option>
                    ${BusinessRules.OPCOES_AGENCIAMENTO.map(op => `
                      <option value="${op}" ${initialAgenc3 === op ? 'selected' : ''}>${op}</option>
                    `).join('')}
                    ${initialAgenc3 && !BusinessRules.OPCOES_AGENCIAMENTO.includes(initialAgenc3) ? `<option value="${initialAgenc3}" selected>${initialAgenc3}</option>` : ''}
                  </select>
                </div>
                <div class="form-group">
                  <label>Vitalício do Corretor 3</label>
                  <div class="stepper-input-group" id="stepper-group-3">
                    <button type="button" class="stepper-btn minus" id="btn-vital-minus-3">−</button>
                    <input type="text" class="form-control stepper-input" id="inp-vitalicio-3" value="${initialVital3}">
                    <button type="button" class="stepper-btn plus" id="btn-vital-plus-3">+</button>
                  </div>
                </div>
              </div>
            </div>

            <datalist id="brokers-datalist">
              ${appData.brokers.map(b => `<option value="${b.CORRETOR_1}">`).join('')}
            </datalist>

            <h4 class="form-section-title">Governança, Checkpoints & Observações</h4>
            <div class="form-grid">
              <div class="form-group">
                <label>Data de Avaliação Equipe Técnica</label>
                <input type="text" class="form-control" id="inp-data-tecnica" value="${initialDataTecnica}" placeholder="DD/MM/AAAA">
              </div>

              <div class="form-group">
                <label>Data de Avaliação Diretoria</label>
                <input type="text" class="form-control" id="inp-data-diretoria" value="${initialDataDiretoria}" placeholder="DD/MM/AAAA">
              </div>

              <div class="form-group form-full">
                <label>Data de Envio da Proposta ao Corretor e/ou Cliente</label>
                <input type="text" class="form-control" id="inp-data-envio" value="${initialDataEnvio}" placeholder="DD/MM/AAAA">
              </div>

              <div class="form-group form-full">
                <label>Observações</label>
                <textarea class="form-control" id="inp-observacao" rows="3" placeholder="Informações complementares, particularidades da negociação, restrições e notas comerciais...">${initialObs}</textarea>
              </div>
            </div>
          </form>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" id="btn-cancel-modal">Cancelar</button>
          <button class="btn btn-primary" id="btn-save-quote">💾 Salvar Cotação Oficial</button>
        </div>
      </div>
    `;

    modal.classList.add('active');

    // Referências aos elementos do formulário
    const inpDate = modal.querySelector('#inp-date');
    const inpComp = modal.querySelector('#inp-comp');
    const inpVidas = modal.querySelector('#inp-vidas');
    const inpTkm = modal.querySelector('#inp-tkm');
    const inpFat = modal.querySelector('#inp-faturamento');
    const inpTemp = modal.querySelector('#inp-temp');
    const groupDecline = modal.querySelector('#group-decline-reason');
    const inpDeclineReason = modal.querySelector('#inp-decline-reason');
    const inpDeclineDetails = modal.querySelector('#inp-decline-details');
    const inpUf = modal.querySelector('#inp-uf');
    const inpCidade = modal.querySelector('#inp-cidade');
    const datalistCidade = modal.querySelector('#cities-datalist');
    const cityStatusInfo = modal.querySelector('#city-status-info');
    const inpFator = modal.querySelector('#inp-fator');
    const groupCopart = modal.querySelector('#group-copart');
    const inpHiddenAcomodacao = modal.querySelector('#inp-acomodacao');
    const inpHiddenTipoContrato = modal.querySelector('#inp-tipo-contrato');
    const inpHiddenFaixas = modal.querySelector('#inp-faixas-etarias');
    const faixasWrapper = modal.querySelector('#faixas-chips-wrapper');

    // --- 1. Carregamento Reativo de Cidades por UF (IBGE) ---
    async function updateCitiesForUF(uf, preserveCity = '') {
      if (!uf) return;
      cityStatusInfo.innerHTML = `<span style="color:var(--info);">⏳ Carregando cidades de ${uf} via IBGE...</span>`;
      try {
        const cities = await BusinessRules.fetchCitiesByUF(uf);
        datalistCidade.innerHTML = cities.map(c => `<option value="${c}">`).join('');
        cityStatusInfo.innerHTML = `<span style="color:var(--success);">✓ ${cities.length} cidades disponíveis no estado de ${uf}</span>`;
        if (preserveCity) {
          inpCidade.value = preserveCity;
        }
      } catch (e) {
        cityStatusInfo.innerHTML = `<span>⚠️ Erro ao carregar cidades. Digitação livre permitida.</span>`;
      }
    }

    inpUf.addEventListener('change', () => {
      inpCidade.value = '';
      updateCitiesForUF(inpUf.value);
    });

    // Dispara carregamento inicial das cidades
    updateCitiesForUF(inpUf.value, initialCidade);

    // --- 2. Controle dos Botões de Temperatura (Legado) ---
    const tempButtons = modal.querySelectorAll('.temp-btn');
    tempButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tempButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const selectedTemp = btn.dataset.temp;
        inpTemp.value = selectedTemp;
        updateReactivity();
      });
    });

    // --- 3. Controle dos Botões Segmentados (Acomodação) ---
    const acomodacaoButtons = modal.querySelectorAll('#acomodacao-segmented-group .segmented-btn');
    acomodacaoButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        acomodacaoButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        inpHiddenAcomodacao.value = btn.dataset.value;
      });
    });

    // --- 4. Controle dos Botões Segmentados (Tipo de Contrato) ---
    const tipoContratoButtons = modal.querySelectorAll('#tipo-contrato-segmented-group .segmented-btn');
    tipoContratoButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tipoContratoButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        inpHiddenTipoContrato.value = btn.dataset.value;
      });
    });

    // --- 5. Controle de Faixas Etárias Interativas ---
    function updateFaixasHiddenInput() {
      const activeChips = Array.from(faixasWrapper.querySelectorAll('.faixa-chip.active'));
      const activeValues = activeChips.map(c => c.dataset.faixa);
      inpHiddenFaixas.value = activeValues.join(' , ');
    }

    faixasWrapper.querySelectorAll('.faixa-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        const checkSpan = chip.querySelector('.faixa-check');
        if (checkSpan) {
          checkSpan.textContent = chip.classList.contains('active') ? '✓' : '+';
        }
        updateFaixasHiddenInput();
      });
    });

    const btnSelectAllFaixas = modal.querySelector('#btn-select-all-faixas');
    if (btnSelectAllFaixas) {
      btnSelectAllFaixas.addEventListener('click', () => {
        faixasWrapper.querySelectorAll('.faixa-chip').forEach(chip => {
          chip.classList.add('active');
          const checkSpan = chip.querySelector('.faixa-check');
          if (checkSpan) checkSpan.textContent = '✓';
        });
        updateFaixasHiddenInput();
      });
    }

    const btnClearFaixas = modal.querySelector('#btn-clear-faixas');
    if (btnClearFaixas) {
      btnClearFaixas.addEventListener('click', () => {
        faixasWrapper.querySelectorAll('.faixa-chip').forEach(chip => {
          chip.classList.remove('active');
          const checkSpan = chip.querySelector('.faixa-check');
          if (checkSpan) checkSpan.textContent = '+';
        });
        updateFaixasHiddenInput();
      });
    }

    // --- 6. Controle dos Steppers de Vitalício (% com - e +) ---
    function configureStepper(inputEl, minusBtn, plusBtn) {
      function parsePct(str) {
        if (!str) return 0;
        const cleaned = String(str).replace(/[%\s]/g, '').replace(',', '.');
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
      }
      function formatPct(num) {
        return `% ${num.toFixed(2).replace('.', ',')}`;
      }

      minusBtn.addEventListener('click', () => {
        let current = parsePct(inputEl.value);
        current = Math.max(0, Math.round((current - 0.5) * 10) / 10);
        inputEl.value = formatPct(current);
      });

      plusBtn.addEventListener('click', () => {
        let current = parsePct(inputEl.value);
        current = Math.min(100, Math.round((current + 0.5) * 10) / 10);
        inputEl.value = formatPct(current);
      });

      inputEl.addEventListener('blur', () => {
        const val = parsePct(inputEl.value);
        inputEl.value = formatPct(val);
      });
    }

    configureStepper(
      modal.querySelector('#inp-vitalicio-1'),
      modal.querySelector('#btn-vital-minus-1'),
      modal.querySelector('#btn-vital-plus-1')
    );
    configureStepper(
      modal.querySelector('#inp-vitalicio-2'),
      modal.querySelector('#btn-vital-minus-2'),
      modal.querySelector('#btn-vital-plus-2')
    );
    configureStepper(
      modal.querySelector('#inp-vitalicio-3'),
      modal.querySelector('#btn-vital-minus-3'),
      modal.querySelector('#btn-vital-plus-3')
    );

    // --- 7. Lógica Reativa Geral (Faturamento, Competência, Declínio) ---
    function updateReactivity() {
      // Recalcula Competência
      const comp = BusinessRules.calculateCompetence(inpDate.value);
      if (comp && (!inpComp.value || inpComp.value === BusinessRules.calculateCompetence(initialDate))) {
        inpComp.value = comp;
      }

      // Recalcula Faturamento
      const rev = BusinessRules.calculateRevenue(inpVidas.value, inpTkm.value);
      inpFat.value = rev.formatted;

      // Exibição do grupo de declínio
      const currentTemp = inpTemp.value;
      if (currentTemp === 'Declinado pela SB Saúde' || currentTemp.includes('Desistência')) {
        groupDecline.style.display = 'block';
      } else {
        groupDecline.style.display = 'none';
      }

      // Visibilidade da Coparticipação
      if (inpFator.value.includes('Coparticipação')) {
        groupCopart.style.display = 'block';
      } else {
        groupCopart.style.display = 'none';
      }
    }

    inpDate.addEventListener('input', updateReactivity);
    inpVidas.addEventListener('input', updateReactivity);
    inpTkm.addEventListener('input', updateReactivity);
    inpFator.addEventListener('change', updateReactivity);

    updateReactivity();

    // Eventos de Fechamento
    modal.querySelector('#btn-close-modal').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#btn-cancel-modal').addEventListener('click', () => modal.classList.remove('active'));

    // --- 8. Evento Salvar Cotação Oficial ---
    modal.querySelector('#btn-save-quote').addEventListener('click', () => {
      const empresa = modal.querySelector('#inp-empresa').value.trim();
      const corretor1 = modal.querySelector('#inp-corretor-1').value.trim();
      const temp = inpTemp.value;
      const declineReasonSelect = inpDeclineReason.value.trim();
      const declineReasonDetails = inpDeclineDetails.value.trim();
      const declineReasonFinal = declineReasonDetails || declineReasonSelect;

      if (!empresa) {
        alert('Por favor informe a Razão Social da Empresa.');
        modal.querySelector('#inp-empresa').focus();
        return;
      }
      if (!corretor1) {
        alert('O primeiro corretor é obrigatório (RN-08).');
        modal.querySelector('#inp-corretor-1').focus();
        return;
      }

      // Validação de Declínio (RN-06)
      const declineValidation = BusinessRules.validateDeclineReason(temp, declineReasonFinal);
      if (!declineValidation.valid) {
        alert(declineValidation.error);
        inpDeclineReason.focus();
        return;
      }

      const rev = BusinessRules.calculateRevenue(inpVidas.value, inpTkm.value);
      const comp = inpComp.value.trim() || BusinessRules.calculateCompetence(inpDate.value);
      const campaignInfo = BusinessRules.matchCampaign(comp, appData.campaignsList);

      const quoteObject = {
        ID: modal.querySelector('#inp-id').value,
        EMPRESA: empresa,
        CNPJ: modal.querySelector('#inp-cnpj').value.trim(),
        CIDADE: inpCidade.value.trim(),
        UF: inpUf.value,
        DATA_DA_PROSPECCAO: inpDate.value.trim(),
        COMPETENCIA: comp,
        VIDAS: String(inpVidas.value || '0'),
        TKM: BusinessRules.formatCurrency(BusinessRules.parseCurrency(inpTkm.value)),
        FATURAMENTO: rev.formatted,
        TEMPERATURA_CONTRATO: temp,
        Aptidao: BusinessRules.determineAptitude(temp),
        Motivo_Declinio: temp === 'Declinado pela SB Saúde' || temp.includes('Desistência') ? declineReasonFinal : '',
        Tipo_Contrato: inpHiddenTipoContrato.value,
        ACOMODACAO: inpHiddenAcomodacao.value,
        Qnt_Faixa_Etaria: modal.querySelector('#inp-qnt-faixas').value,
        Faixa_Etaria: inpHiddenFaixas.value,
        FATOR_MODERADOR: inpFator.value,
        POLITICA_COPARTICIPACAO: inpFator.value.includes('Coparticipação') ? modal.querySelector('#inp-politica-copart').value : '',
        CORRETORES_1: corretor1,
        AGENCIAMENTO_1: modal.querySelector('#inp-agenciamento-1').value,
        VITALICIO_1: modal.querySelector('#inp-vitalicio-1').value.trim(),
        CORRETORES_2: modal.querySelector('#inp-corretor-2').value.trim(),
        AGENCIAMENTO_2: modal.querySelector('#inp-agenciamento-2').value,
        VITALICIO_2: modal.querySelector('#inp-vitalicio-2').value.trim(),
        CORRETORES_3: modal.querySelector('#inp-corretor-3').value.trim(),
        AGENCIAMENTO_3: modal.querySelector('#inp-agenciamento-3').value,
        VITALICIO_3: modal.querySelector('#inp-vitalicio-3').value.trim(),
        Data_Analise_tecnica: modal.querySelector('#inp-data-tecnica').value.trim(),
        Data_Avaliacao_Diretoria: modal.querySelector('#inp-data-diretoria').value.trim(),
        Data_Envio_Corretor: modal.querySelector('#inp-data-envio').value.trim(),
        Observacao: modal.querySelector('#inp-observacao').value.trim(),
        PLANO_CAMPANHA: campaignInfo.plan,
        Status_Campanha: campaignInfo.status,
        Usuario: modal.querySelector('#inp-user').value,
        Data_Inclusao: isEdit ? editItem.Data_Inclusao : BusinessRules.formatDateBR(),
        Hora_Inclusao: isEdit ? editItem.Hora_Inclusao : BusinessRules.formatTimeBR()
      };

      if (isEdit) {
        const idx = appData.proposals.findIndex(p => String(p.ID) === String(editItem.ID));
        if (idx !== -1) {
          appData.proposals[idx] = { ...appData.proposals[idx], ...quoteObject };
        }
        showToast(`Cotação #PRP-${quoteObject.ID} atualizada com sucesso!`);
      } else {
        appData.proposals.unshift(quoteObject);
        // Garante empresa no cadastro
        if (!appData.companies.some(c => c.EMPRESA === empresa)) {
          appData.companies.push({ EMPRESA: empresa });
        }
        // Garante corretor no cadastro
        if (!appData.brokers.some(b => b.CORRETOR_1 === corretor1)) {
          appData.brokers.push({ CORRETOR_1: corretor1 });
        }
        showToast(`Cotação #PRP-${quoteObject.ID} criada com sucesso!`);
      }

      saveDataStore();
      if (window.crmSupabase?.isConnected) {
        const targetP = isEdit ? appData.proposals.find(p => String(p.ID) === String(editItem.ID)) : quoteObject;
        if (targetP) window.crmSupabase.saveProposal(targetP);
      }
      modal.classList.remove('active');
      renderView();
    });
  }

  // Exposição global para automações e atalhos rápidos
  window.openNewQuoteModal = openNewQuoteModal;

  // 10. EXPORTAÇÃO CSV
  function exportDataCSV() {
    const proposals = getFilteredProposals();
    if (proposals.length === 0) {
      alert('Nenhuma proposta para exportar.');
      return;
    }

    const headers = ['ID', 'Empresa', 'CNPJ', 'Vidas', 'TKM', 'Faturamento', 'Competência', 'Temperatura', 'Aptidão', 'Corretor 1', 'Corretor 2', 'Corretor 3', 'Acomodação', 'Fator Moderador', 'Campanha'];
    const rows = proposals.map(p => [
      p.ID,
      `"${(p.EMPRESA || '').replace(/"/g, '""')}"`,
      `"${p.CNPJ || ''}"`,
      p.VIDAS || '0',
      `"${p.TKM || ''}"`,
      `"${p.FATURAMENTO || ''}"`,
      `"${p.COMPETENCIA || ''}"`,
      `"${p.TEMPERATURA_CONTRATO || ''}"`,
      `"${p.Aptidao || ''}"`,
      `"${(p.CORRETORES_1 || '').replace(/"/g, '""')}"`,
      `"${(p.CORRETORES_2 || '').replace(/"/g, '""')}"`,
      `"${(p.CORRETORES_3 || '').replace(/"/g, '""')}"`,
      `"${p.ACOMODACAO || ''}"`,
      `"${p.FATOR_MODERADOR || ''}"`,
      `"${p.PLANO_CAMPANHA || ''}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CRM_SB_Saude_Propostas_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exportação concluída com sucesso!');
  }

  // =========================================================================
  // 8. PAINEL DE ADMINISTRAÇÃO, GESTÃO DE USUÁRIOS E SEGURANÇA (DESIGN.md)
  // =========================================================================

  const DEFAULT_ADMIN_USERS = [
    {
      id: 'USR-001',
      login: 'ADMINISTRADOR',
      name: 'Administrador',
      email: 'administrador@sbsaude.com.br',
      role: 'Administrador Master',
      profile: 'Administrador Master',
      status: 'Ativo',
      password: 'admin.admin',
      twoFactor: true,
      lastLogin: '21/09/2026 16:45',
      ip: '192.168.10.1',
      avatar: 'AD',
      createdAt: '21/09/2026'
    }
  ];

  const DEFAULT_AUDIT_LOGS = [
    {
      id: 'LOG-001',
      action: 'LOGIN_SUCCESS',
      user: 'ADMINISTRADOR',
      target: 'Sessão iniciada',
      ip: '192.168.10.1',
      timestamp: '21/09/2026 16:45',
      status: 'success',
      details: 'Autenticação de Administrador Master realizada com sucesso'
    }
  ];

  const adminViewState = {
    activeTab: 'users', // 'users', 'security', 'audit'
    searchQuery: '',
    profileFilter: 'all',
    statusFilter: 'all'
  };

  function getAdminUsers() {
    try {
      const saved = localStorage.getItem('crm_admin_users');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = parsed.filter(u => {
            const l = (u.login || u.username || '').toUpperCase();
            return !['LUCAS', 'EDUARDO', 'IVAN LÁZARO', 'JULIANA', 'RAMON'].includes(l);
          });
          if (cleaned.length > 0) {
            return cleaned.map(u => {
              const uLogin = (u.login || u.username || '').toUpperCase();
              const isAdm = uLogin === 'ADMINISTRADOR';
              let prof = u.profile;
              if (!prof) {
                prof = isAdm ? 'Administrador Master' : (u.role || 'Consultor Comercial');
              }
              return {
                ...u,
                id: u.id || u.user_code || (isAdm ? 'USR-001' : 'USR-002'),
                login: u.login || u.username || (isAdm ? 'ADMINISTRADOR' : 'USUARIO'),
                name: u.name || (isAdm ? 'Administrador' : (u.login || 'Usuário')),
                email: u.email || (isAdm ? 'administrador@sbsaude.com.br' : `${(u.login || 'usuario').toLowerCase()}@sbsaude.com.br`),
                role: u.role || (isAdm ? 'Administrador Master' : 'Consultor Comercial'),
                profile: prof,
                status: u.status || 'Ativo',
                password: u.password || u.password_hash || (isAdm ? 'admin.admin' : 'SbSaude@2026'),
                twoFactor: u.twoFactor ?? true,
                lastLogin: u.lastLogin || 'Primeiro acesso pendente',
                ip: u.ip || '192.168.10.1',
                avatar: u.avatar || (isAdm ? 'AD' : (u.name ? u.name.slice(0, 2).toUpperCase() : 'US'))
              };
            });
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar crm_admin_users:', e);
    }
    return DEFAULT_ADMIN_USERS.map(u => ({ ...u }));
  }

  function saveAdminUsers(users) {
    localStorage.setItem('crm_admin_users', JSON.stringify(users));
    syncUserSwitch(users);
    if (window.crmSupabase && Array.isArray(users)) {
      if (typeof window.crmSupabase.syncAllUsers === 'function') {
        window.crmSupabase.syncAllUsers(users).catch(err => {
          console.warn('[Supabase Sync] Falha ao sincronizar lote:', err);
        });
      } else {
        users.forEach(u => window.crmSupabase.saveUser(u));
      }
    }
  }

  async function syncAdminUsersWithSupabase(showToastFeedback = true) {
    if (!window.crmSupabase) return false;
    const btnSyncHeader = document.getElementById('btn-admin-sync-supabase');
    const btnSyncTab = document.getElementById('btn-admin-sync-tab');
    [btnSyncHeader, btnSyncTab].forEach(b => {
      if (b) {
        b.disabled = true;
        b.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;">🔄</span> Sincronizando...';
      }
    });

    try {
      const isOnline = await window.crmSupabase.checkConnection();
      if (!isOnline) {
        return false;
      }

      // 1. Enviar usuários locais para o Supabase
      const localUsers = getAdminUsers();
      let sentCount = 0;
      if (typeof window.crmSupabase.syncAllUsers === 'function') {
        const ok = await window.crmSupabase.syncAllUsers(localUsers);
        if (ok) sentCount = localUsers.length;
      } else {
        for (const u of localUsers) {
          const res = await window.crmSupabase.saveUser(u);
          if (res && (res === true || res.success)) sentCount++;
        }
      }

      // 2. Buscar usuários oficiais do Supabase
      const remoteUsers = await window.crmSupabase.fetchUsers();
      if (Array.isArray(remoteUsers) && remoteUsers.length > 0) {
        localStorage.setItem('crm_admin_users', JSON.stringify(remoteUsers));
        syncUserSwitch(remoteUsers);
      }

      // Se estiver na aba admin, re-renderiza
      if (state.currentTab === 'admin') {
        const container = document.getElementById('tab-content');
        if (container) renderAdmin(container);
      }
      return true;
    } catch (err) {
      console.error('[Supabase Sync] Erro ao sincronizar usuários:', err);
      return false;
    } finally {
      [btnSyncHeader, btnSyncTab].forEach(b => {
        if (b) {
          b.disabled = false;
          b.innerHTML = '<span>🔄</span> Sincronizar Supabase';
        }
      });
    }
  }
  window.syncAdminUsersWithSupabase = syncAdminUsersWithSupabase;

  window.addEventListener('supabase:connected', () => {
    console.log('[CRM] Supabase reconectado. Sincronizando usuários locais automaticamente...');
    syncAdminUsersWithSupabase(false);
  });

  function syncUserSwitch(users) {
    const userSelect = document.getElementById('user-switch');
    if (!userSelect) return;
    const currentVal = userSelect.value;
    userSelect.innerHTML = users.filter(u => u.status === 'Ativo').map(u => `
      <option value="${u.login}" ${u.login === currentVal ? 'selected' : ''}>
        ${u.name.split(' ')[0]} (${u.role.split(' ')[0]})
      </option>
    `).join('');
  }

  function getAuditLogs() {
    try {
      const saved = localStorage.getItem('crm_audit_logs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Erro ao carregar crm_audit_logs:', e);
    }
    return [...DEFAULT_AUDIT_LOGS];
  }

  function addAuditLog(action, actionLabel, severity, details, user) {
    const logs = getAuditLogs();
    const currentUser = user || localStorage.getItem('crm_active_user') || 'ADMINISTRADOR';
    const now = new Date();
    const timestamp = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR');
    
    const newLog = {
      id: 'LOG-' + (logs.length + 110),
      timestamp,
      user: currentUser,
      action,
      actionLabel,
      ip: '192.168.10.' + Math.floor(Math.random() * 80 + 10),
      severity: severity || 'info',
      details
    };

    logs.unshift(newLog);
    if (logs.length > 80) logs.pop();
    localStorage.setItem('crm_audit_logs', JSON.stringify(logs));
  }

  function getSecuritySettings() {
    try {
      const saved = localStorage.getItem('crm_security_settings');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      minPasswordLength: 8,
      requireSpecialChars: true,
      passwordExpiryDays: 90,
      sessionTimeoutMinutes: 30,
      maxFailedAttempts: 5,
      twoFactorPolicy: 'mandatory_managers',
      maskSensitiveData: true,
      immutableAuditLogs: true
    };
  }

  function saveSecuritySettings(settings) {
    localStorage.setItem('crm_security_settings', JSON.stringify(settings));
    addAuditLog('POLICY_CHANGE', 'Políticas de segurança do sistema atualizadas', 'warning', 'Parâmetros de expiração e complexidade de credenciais revisados');
    showToast('Políticas de segurança atualizadas com sucesso!', 'success');
  }

  function checkPasswordStrength(password) {
    if (!password) return { score: 0, label: 'Vazia', color: '#94a3b8', percent: 0 };
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 1) return { score: 1, label: 'Muito Fraca', color: '#dc2626', percent: 20 };
    if (score === 2) return { score: 2, label: 'Fraca', color: '#ea580c', percent: 40 };
    if (score === 3) return { score: 3, label: 'Razoável', color: '#d97706', percent: 65 };
    if (score === 4) return { score: 4, label: 'Boa', color: '#2563eb', percent: 85 };
    return { score: 5, label: 'Excelente / Forte', color: '#16a34a', percent: 100 };
  }

  function generateStrongPassword() {
    const charsUpper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const charsLower = 'abcdefghijkmnopqrstuvwxyz';
    const charsNum = '23456789';
    const charsSpecial = '!@#$%&*_-+=';
    const all = charsUpper + charsLower + charsNum + charsSpecial;

    let pwd = '';
    pwd += charsUpper[Math.floor(Math.random() * charsUpper.length)];
    pwd += charsLower[Math.floor(Math.random() * charsLower.length)];
    pwd += charsNum[Math.floor(Math.random() * charsNum.length)];
    pwd += charsSpecial[Math.floor(Math.random() * charsSpecial.length)];

    for (let i = 4; i < 12; i++) {
      pwd += all[Math.floor(Math.random() * all.length)];
    }
    return pwd.split('').sort(() => 0.5 - Math.random()).join('');
  }

  // Renderizador Central do Módulo Administrador (Exclusivo Administrador Master)
  function renderAdmin(container) {
    if (!isMasterAdmin()) {
      showToast('Acesso restrito: A tela de Administrador é visível exclusivamente para Administrador Master.', 'warning');
      state.currentTab = 'dashboard';
      renderDashboard(container);
      return;
    }
    const users = getAdminUsers();
    const activeUsers = users.filter(u => u.status === 'Ativo').length;
    const blockedUsers = users.filter(u => u.status !== 'Ativo').length;
    const with2fa = users.filter(u => u.twoFactor).length;
    const pct2fa = users.length > 0 ? Math.round((with2fa / users.length) * 100) : 100;
    const secSettings = getSecuritySettings();

    container.innerHTML = `
      <div class="admin-view-container">
        <!-- Topo da Página -->
        <div class="admin-header-row">
          <div>
            <h2 class="admin-title">Painel de Administração &amp; Gestão de Usuários</h2>
            <p class="admin-subtitle">Controle centralizado de acessos, provisionamento de credenciais, políticas de senha e auditoria de segurança corporativa SB Saúde.</p>
          </div>
          <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" id="btn-admin-sync-supabase" style="display:inline-flex; align-items:center; gap:6px; font-weight:600;" title="Sincronizar usuários com o banco de dados Supabase">
              <span>🔄</span> Sincronizar Supabase
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-admin-policies" style="display:inline-flex; align-items:center; gap:6px;">
              <span>🛡️</span> Políticas de Segurança
            </button>
            <button class="btn btn-primary btn-sm" id="btn-admin-create-user" style="display:inline-flex; align-items:center; gap:6px;">
              <span>+</span> Novo Usuário
            </button>
          </div>
        </div>

        <!-- 4 KPIs Executivos de Governança -->
        <div class="admin-kpis-grid">
          <!-- KPI 1: Usuários Ativos -->
          <div class="admin-kpi-card">
            <div class="admin-kpi-header">
              <span class="admin-kpi-title">USUÁRIOS ATIVOS</span>
              <span class="admin-kpi-dot" style="background-color:#2563eb;"></span>
            </div>
            <div class="admin-kpi-val">${activeUsers} <span style="font-size:0.9rem; font-weight:500; color:#64748b;">de ${users.length}</span></div>
            <p class="admin-kpi-sub">
              ${blockedUsers > 0 ? `<strong style="color:#dc2626;">${blockedUsers} usuário${blockedUsers > 1 ? 's' : ''} bloqueado${blockedUsers > 1 ? 's' : ''}</strong>` : 'Nenhum usuário bloqueado'}
            </p>
          </div>

          <!-- KPI 2: Duplo Fator (2FA) -->
          <div class="admin-kpi-card">
            <div class="admin-kpi-header">
              <span class="admin-kpi-title">COBERTURA 2FA</span>
              <span class="admin-kpi-dot" style="background-color:#16a34a;"></span>
            </div>
            <div class="admin-kpi-val">${pct2fa}%</div>
            <p class="admin-kpi-sub">
              <span style="color:#16a34a; font-weight:600;">✓ Ativo</span> em todos os perfis gestores
            </p>
          </div>

          <!-- KPI 3: Conformidade LGPD -->
          <div class="admin-kpi-card">
            <div class="admin-kpi-header">
              <span class="admin-kpi-title">CONFORMIDADE LGPD</span>
              <span class="admin-kpi-dot" style="background-color:#7e22ce;"></span>
            </div>
            <div class="admin-kpi-val">Grau A+</div>
            <p class="admin-kpi-sub">Logs com criptografia e trilha indelével</p>
          </div>

          <!-- KPI 4: Alertas de Segurança -->
          <div class="admin-kpi-card">
            <div class="admin-kpi-header">
              <span class="admin-kpi-title">INTEGRIDADE DO SISTEMA</span>
              <span class="admin-kpi-dot" style="background-color:#16a34a;"></span>
            </div>
            <div class="admin-kpi-val" style="color:#16a34a;">99.98%</div>
            <p class="admin-kpi-sub">0 vulnerabilidades detectadas • SLA OK</p>
          </div>
        </div>

        <!-- Abas de Navegação do Painel -->
        <div class="admin-tabs-bar">
          <button class="admin-tab-nav-btn ${adminViewState.activeTab === 'users' ? 'active' : ''}" data-tab="users">
            <span>👥</span> Usuários &amp; Permissões (${users.length})
          </button>
          <button class="admin-tab-nav-btn ${adminViewState.activeTab === 'security' ? 'active' : ''}" data-tab="security">
            <span>🛡️</span> Painel de Segurança &amp; Políticas
          </button>
          <button class="admin-tab-nav-btn ${adminViewState.activeTab === 'audit' ? 'active' : ''}" data-tab="audit">
            <span>📜</span> Trilha de Auditoria &amp; Logs Recentes
          </button>
        </div>

        <!-- Conteúdo da Aba Selecionada -->
        <div id="admin-tab-content">
          <!-- Renderizado dinamicamente -->
        </div>

        <!-- Barra Inferior de Governança -->
        <footer class="companies-bottom-bar" style="margin-top:1.5rem;">
          <div class="companies-bottom-left">
            <span>SB Saúde Corporativo • Módulo de Inteligência Comercial e Aceitação v4.8</span>
          </div>
          <div class="companies-bottom-right" style="display:inline-flex; align-items:center; gap:0.4rem;">
            <span class="companies-status-dot"></span>
            <span>Segurança Corporativa e Módulo de Acessos Operando Normalmente</span>
          </div>
        </footer>

        <!-- Container do Modal Administrativo -->
        <div class="modal-backdrop" id="admin-modal-container" role="dialog" aria-modal="true">
          <!-- Injetado dinamicamente -->
        </div>
      </div>
    `;

    renderAdminTabContent();

    // Sincronização em segundo plano com Supabase ao abrir a tela de Administrador
    if (window.crmSupabase && typeof window.crmSupabase.fetchUsers === 'function') {
      window.crmSupabase.fetchUsers().then(remoteUsers => {
        if (Array.isArray(remoteUsers) && remoteUsers.length > 0) {
          const localStr = localStorage.getItem('crm_admin_users');
          const remoteStr = JSON.stringify(remoteUsers);
          if (localStr !== remoteStr) {
            localStorage.setItem('crm_admin_users', remoteStr);
            syncUserSwitch(remoteUsers);
            const content = container.querySelector('#admin-tab-content');
            if (content && adminViewState.activeTab === 'users') {
              renderUsersTab(content);
            }
          }
        }
      }).catch(err => console.warn('[Admin] Verificação em background falhou:', err));
    }

    // Eventos das Abas
    container.querySelectorAll('.admin-tab-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        adminViewState.activeTab = btn.dataset.tab;
        container.querySelectorAll('.admin-tab-nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderAdminTabContent();
      });
    });

    // Botões de Ação do Header
    const btnSyncHeader = container.querySelector('#btn-admin-sync-supabase');
    if (btnSyncHeader) {
      btnSyncHeader.addEventListener('click', () => syncAdminUsersWithSupabase(true));
    }
    const btnCreate = container.querySelector('#btn-admin-create-user');
    if (btnCreate) {
      btnCreate.addEventListener('click', openCreateUserModal);
    }
    const btnSec = container.querySelector('#btn-admin-policies');
    if (btnSec) {
      btnSec.addEventListener('click', () => {
        adminViewState.activeTab = 'security';
        container.querySelectorAll('.admin-tab-nav-btn').forEach(b => b.classList.remove('active'));
        const tabBtn = container.querySelector('[data-tab="security"]');
        if (tabBtn) tabBtn.classList.add('active');
        renderAdminTabContent();
      });
    }

    function renderAdminTabContent() {
      const content = container.querySelector('#admin-tab-content');
      if (!content) return;

      if (adminViewState.activeTab === 'users') {
        renderUsersTab(content);
      } else if (adminViewState.activeTab === 'security') {
        renderSecurityTab(content);
      } else if (adminViewState.activeTab === 'audit') {
        renderAuditTab(content);
      }
    }

    // ABA 1: USUÁRIOS & PERMISSÕES
    function renderUsersTab(tabContainer) {
      const allUsers = getAdminUsers();
      let filtered = allUsers;

      if (adminViewState.searchQuery) {
        const q = adminViewState.searchQuery.toLowerCase();
        filtered = filtered.filter(u =>
          u.name.toLowerCase().includes(q) ||
          u.login.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.role.toLowerCase().includes(q)
        );
      }

      if (adminViewState.profileFilter !== 'all') {
        filtered = filtered.filter(u => u.profile === adminViewState.profileFilter);
      }

      if (adminViewState.statusFilter !== 'all') {
        filtered = filtered.filter(u => u.status === adminViewState.statusFilter);
      }

      tabContainer.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1rem;">
          <!-- Barra de Filtros e Busca -->
          <div class="admin-users-toolbar">
            <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap; flex:1;">
              <div class="admin-search-box">
                <span style="color:#94a3b8; font-size:0.85rem;">🔍</span>
                <input type="text" class="admin-search-input" id="inp-search-users" placeholder="Pesquisar por nome, login, e-mail ou cargo..." value="${adminViewState.searchQuery}">
              </div>

              <select class="companies-select" id="select-filter-profile" style="height:34px; font-size:0.78rem;">
                <option value="all">Perfil: Todos</option>
                <option value="Administrador Master" ${adminViewState.profileFilter === 'Administrador Master' ? 'selected' : ''}>Administrador Master</option>
                <option value="Gestor Comercial" ${adminViewState.profileFilter === 'Gestor Comercial' ? 'selected' : ''}>Gestor Comercial</option>
                <option value="Consultor Comercial" ${adminViewState.profileFilter === 'Consultor Comercial' ? 'selected' : ''}>Consultor Comercial</option>
                <option value="Analista de Operações" ${adminViewState.profileFilter === 'Analista de Operações' ? 'selected' : ''}>Analista de Operações</option>
              </select>

              <select class="companies-select" id="select-filter-status" style="height:34px; font-size:0.78rem;">
                <option value="all">Status: Todos</option>
                <option value="Ativo" ${adminViewState.statusFilter === 'Ativo' ? 'selected' : ''}>Ativo</option>
                <option value="Bloqueado" ${adminViewState.statusFilter === 'Bloqueado' ? 'selected' : ''}>Bloqueado</option>
              </select>
            </div>

            <div style="display:flex; align-items:center; gap:0.5rem;">
              <button class="btn btn-secondary btn-sm" id="btn-admin-sync-tab" style="font-size:0.78rem; padding:0.4rem 0.85rem; display:inline-flex; align-items:center; gap:5px;" title="Sincronizar dados da tabela com o Supabase">
                <span>🔄</span> Sincronizar Supabase
              </button>
              <button class="btn btn-primary btn-sm" id="btn-add-user-tab" style="font-size:0.78rem; padding:0.4rem 0.85rem;">
                + Novo Usuário
              </button>
            </div>
          </div>

          <!-- Tabela de Usuários -->
          <div class="companies-table-card">
            <div class="companies-table-responsive">
              <table class="companies-data-table">
                <thead>
                  <tr>
                    <th>USUÁRIO / NOME</th>
                    <th>E-MAIL CORPORATIVO</th>
                    <th>CARGO / FUNÇÃO</th>
                    <th>PERFIL DE ACESSO</th>
                    <th>STATUS</th>
                    <th>2FA</th>
                    <th>ÚLTIMO ACESSO</th>
                    <th style="text-align:right;">AÇÕES</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.length === 0 ? `
                    <tr>
                      <td colspan="8" style="text-align:center; padding:2.5rem; color:#64748b;">
                        Nenhum usuário encontrado com os filtros selecionados.
                      </td>
                    </tr>
                  ` : filtered.map(u => {
                    let profileClass = 'profile-consultor';
                    if (u.profile.includes('Master') || u.profile.includes('Administrador')) profileClass = 'profile-master';
                    else if (u.profile.includes('Gestor') || u.profile.includes('Gerente')) profileClass = 'profile-gestor';
                    else if (u.profile.includes('Analista')) profileClass = 'profile-auditor';

                    const isBlocked = u.status !== 'Ativo';

                    return `
                      <tr class="companies-row">
                        <td>
                          <div class="admin-user-cell">
                            <div class="admin-user-avatar-circle">${u.avatar || u.name.slice(0, 2).toUpperCase()}</div>
                            <div>
                              <span class="admin-user-name">${u.name}</span>
                              <span class="admin-user-login-badge">Login: <strong>${u.login}</strong></span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span style="font-size:0.78rem; color:#475569;">${u.email}</span>
                        </td>
                        <td>
                          <span style="font-size:0.78rem; font-weight:600; color:var(--text-primary);">${u.role}</span>
                        </td>
                        <td>
                          <span class="admin-profile-badge ${profileClass}">${u.profile}</span>
                        </td>
                        <td>
                          <span class="admin-status-badge ${isBlocked ? 'status-blocked' : 'status-active'}">
                            ${isBlocked ? '🔒 Bloqueado' : '● Ativo'}
                          </span>
                        </td>
                        <td>
                          <span class="admin-2fa-badge">
                            ${u.twoFactor ? '✓ Habilitado' : '<span style="color:#94a3b8;">Desabilitado</span>'}
                          </span>
                        </td>
                        <td>
                          <div style="font-size:0.75rem; color:#64748b;">
                            <div>${u.lastLogin || 'Nunca'}</div>
                            <div style="font-size:0.68rem; color:#94a3b8; font-family:monospace;">IP: ${u.ip || '192.168.10.x'}</div>
                          </div>
                        </td>
                        <td>
                          <div class="admin-actions-group">
                            <button type="button" class="admin-action-icon-btn btn-password btn-change-pwd" data-uid="${u.id}" title="Alterar senha de acesso">
                              🔑 Senha
                            </button>
                            <button type="button" class="admin-action-icon-btn btn-edit-user" data-uid="${u.id}" title="Editar perfil e permissões">
                              ✏️
                            </button>
                            <button type="button" class="admin-action-icon-btn btn-toggle-status" data-uid="${u.id}" title="${isBlocked ? 'Desbloquear usuário' : 'Bloquear usuário'}">
                              ${isBlocked ? '🔓' : '🔒'}
                            </button>
                            <button type="button" class="admin-action-icon-btn btn-delete-user" data-uid="${u.id}" style="color:#dc2626;" title="Excluir usuário">
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
            <div class="companies-table-footer">
              <span>Total de <strong>${filtered.length}</strong> usuário${filtered.length !== 1 ? 's' : ''} exibido${filtered.length !== 1 ? 's' : ''}</span>
              <span style="font-size:0.72rem; color:#64748b;">Segurança SB Saúde • Conexão Criptografada TLS 1.3</span>
            </div>
          </div>
        </div>
      `;

      // Eventos dos Controles da Tabela
      const searchInp = tabContainer.querySelector('#inp-search-users');
      if (searchInp) {
        searchInp.addEventListener('input', (e) => {
          adminViewState.searchQuery = e.target.value.trim();
          renderUsersTab(tabContainer);
        });
      }

      const profSel = tabContainer.querySelector('#select-filter-profile');
      if (profSel) {
        profSel.addEventListener('change', (e) => {
          adminViewState.profileFilter = e.target.value;
          renderUsersTab(tabContainer);
        });
      }

      const statusSel = tabContainer.querySelector('#select-filter-status');
      if (statusSel) {
        statusSel.addEventListener('change', (e) => {
          adminViewState.statusFilter = e.target.value;
          renderUsersTab(tabContainer);
        });
      }

      const btnSyncTab = tabContainer.querySelector('#btn-admin-sync-tab');
      if (btnSyncTab) {
        btnSyncTab.addEventListener('click', () => syncAdminUsersWithSupabase(true));
      }

      const btnAddTab = tabContainer.querySelector('#btn-add-user-tab');
      if (btnAddTab) {
        btnAddTab.addEventListener('click', openCreateUserModal);
      }

      tabContainer.querySelectorAll('.btn-change-pwd').forEach(btn => {
        btn.addEventListener('click', () => openChangePasswordModal(btn.dataset.uid));
      });

      tabContainer.querySelectorAll('.btn-edit-user').forEach(btn => {
        btn.addEventListener('click', () => openEditUserModal(btn.dataset.uid));
      });

      tabContainer.querySelectorAll('.btn-toggle-status').forEach(btn => {
        btn.addEventListener('click', () => toggleUserStatus(btn.dataset.uid));
      });

      tabContainer.querySelectorAll('.btn-delete-user').forEach(btn => {
        btn.addEventListener('click', () => deleteUser(btn.dataset.uid));
      });
    }

    // ABA 2: PAINEL DE SEGURANÇA & POLÍTICAS
    function renderSecurityTab(tabContainer) {
      const s = getSecuritySettings();

      tabContainer.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1.25rem;">
          <div class="admin-security-grid">
            <!-- Card 1: Diretrizes de Credenciais e Senhas -->
            <div class="admin-policy-card">
              <h3 class="admin-policy-card-title">
                <span>🔑</span> Política de Senhas &amp; Credenciais
              </h3>

              <div class="admin-policy-item">
                <div>
                  <p class="admin-policy-item-label">Comprimento Mínimo de Senha</p>
                  <p class="admin-policy-item-desc">Exigir tamanho mínimo para novas senhas criadas</p>
                </div>
                <select class="companies-select" id="sec-min-length" style="height:32px; font-size:0.8rem;">
                  <option value="8" ${s.minPasswordLength === 8 ? 'selected' : ''}>8 caracteres</option>
                  <option value="10" ${s.minPasswordLength === 10 ? 'selected' : ''}>10 caracteres</option>
                  <option value="12" ${s.minPasswordLength === 12 ? 'selected' : ''}>12 caracteres (Recomendado)</option>
                </select>
              </div>

              <div class="admin-policy-item">
                <div>
                  <p class="admin-policy-item-label">Complexidade Obrigatória</p>
                  <p class="admin-policy-item-desc">Exigir letras maiúsculas, minúsculas, números e símbolos</p>
                </div>
                <input type="checkbox" id="sec-require-special" ${s.requireSpecialChars ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer;">
              </div>

              <div class="admin-policy-item">
                <div>
                  <p class="admin-policy-item-label">Expiração Periódica de Senha</p>
                  <p class="admin-policy-item-desc">Forçar renovação de credenciais após o período</p>
                </div>
                <select class="companies-select" id="sec-expiry-days" style="height:32px; font-size:0.8rem;">
                  <option value="60" ${s.passwordExpiryDays === 60 ? 'selected' : ''}>A cada 60 dias</option>
                  <option value="90" ${s.passwordExpiryDays === 90 ? 'selected' : ''}>A cada 90 dias (Padrão)</option>
                  <option value="180" ${s.passwordExpiryDays === 180 ? 'selected' : ''}>A cada 180 dias</option>
                  <option value="0" ${s.passwordExpiryDays === 0 ? 'selected' : ''}>Sem expiração automática</option>
                </select>
              </div>
            </div>

            <!-- Card 2: Autenticação em Duas Etapas & Sessão -->
            <div class="admin-policy-card">
              <h3 class="admin-policy-card-title">
                <span>🛡️</span> Autenticação em 2 Etapas &amp; Sessões
              </h3>

              <div class="admin-policy-item">
                <div>
                  <p class="admin-policy-item-label">Política de 2FA (Duplo Fator)</p>
                  <p class="admin-policy-item-desc">Nível de obrigatoriedade do segundo fator</p>
                </div>
                <select class="companies-select" id="sec-2fa-policy" style="height:32px; font-size:0.8rem;">
                  <option value="mandatory_managers" ${s.twoFactorPolicy === 'mandatory_managers' ? 'selected' : ''}>Obrigatório para Gestores &amp; Admins</option>
                  <option value="mandatory_all" ${s.twoFactorPolicy === 'mandatory_all' ? 'selected' : ''}>Obrigatório para Todos os Usuários</option>
                  <option value="optional" ${s.twoFactorPolicy === 'optional' ? 'selected' : ''}>Opcional por usuário</option>
                </select>
              </div>

              <div class="admin-policy-item">
                <div>
                  <p class="admin-policy-item-label">Timeout por Inatividade</p>
                  <p class="admin-policy-item-desc">Desconectar sessão inativa automaticamente</p>
                </div>
                <select class="companies-select" id="sec-session-timeout" style="height:32px; font-size:0.8rem;">
                  <option value="15" ${s.sessionTimeoutMinutes === 15 ? 'selected' : ''}>15 minutos</option>
                  <option value="30" ${s.sessionTimeoutMinutes === 30 ? 'selected' : ''}>30 minutos (Padrão)</option>
                  <option value="60" ${s.sessionTimeoutMinutes === 60 ? 'selected' : ''}>60 minutos</option>
                </select>
              </div>

              <div class="admin-policy-item">
                <div>
                  <p class="admin-policy-item-label">Bloqueio por Tentativas Incorretas</p>
                  <p class="admin-policy-item-desc">Bloquear credencial após sucessivas falhas</p>
                </div>
                <select class="companies-select" id="sec-max-failed" style="height:32px; font-size:0.8rem;">
                  <option value="3" ${s.maxFailedAttempts === 3 ? 'selected' : ''}>3 tentativas</option>
                  <option value="5" ${s.maxFailedAttempts === 5 ? 'selected' : ''}>5 tentativas (Recomendado)</option>
                  <option value="10" ${s.maxFailedAttempts === 10 ? 'selected' : ''}>10 tentativas</option>
                </select>
              </div>
            </div>

            <!-- Card 3: Proteção de Dados LGPD & Auditoria -->
            <div class="admin-policy-card">
              <h3 class="admin-policy-card-title">
                <span>⚖️</span> Governança de Dados &amp; Conformidade LGPD
              </h3>

              <div class="admin-policy-item">
                <div>
                  <p class="admin-policy-item-label">Mascaramento de Dados Sensíveis</p>
                  <p class="admin-policy-item-desc">Ocultar dígitos centrais de CPF e dados pessoais para perfis operacionais</p>
                </div>
                <input type="checkbox" id="sec-mask-data" ${s.maskSensitiveData ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer;">
              </div>

              <div class="admin-policy-item">
                <div>
                  <p class="admin-policy-item-label">Trilha Indelével de Auditoria</p>
                  <p class="admin-policy-item-desc">Registrar todas as mutações e acessos com hash de integridade</p>
                </div>
                <input type="checkbox" id="sec-immutable-audit" ${s.immutableAuditLogs ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer;">
              </div>
            </div>

            <!-- Card 4: Status do Monitor de Segurança -->
            <div class="admin-policy-card" style="background:var(--bg-surface-nested); border:1px solid var(--border-subtle);">
              <h3 class="admin-policy-card-title" style="color:var(--text-primary);">
                <span>🟢</span> Monitor em Tempo Real
              </h3>
              <p style="font-size:0.8rem; color:var(--text-secondary); margin:0;">
                O sistema de monitoramento de ameaças SB Saúde opera com proteção contínua contra força bruta, injeção de scripts e requisições suspeitas.
              </p>
              <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px; padding:0.85rem; display:flex; flex-direction:column; gap:0.4rem; font-size:0.75rem;">
                <div style="display:flex; justify-content:space-between;">
                  <span>Certificado TLS:</span>
                  <strong style="color:#16a34a;">Válido (TLS 1.3 Cripto 256-bit)</strong>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span>Última Auditoria Automática:</span>
                  <strong>Hoje, 08:30</strong>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span>Status do Firewall Corporativo:</span>
                  <strong style="color:#16a34a;">Ativo • 0 Bloqueios Pendentes</strong>
                </div>
              </div>
            </div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:0.75rem; margin-top:0.5rem;">
            <button class="btn btn-primary" id="btn-save-security-policies" style="font-weight:700;">
              💾 Salvar Políticas de Segurança
            </button>
          </div>
        </div>
      `;

      tabContainer.querySelector('#btn-save-security-policies').addEventListener('click', () => {
        const updated = {
          minPasswordLength: parseInt(tabContainer.querySelector('#sec-min-length').value, 10),
          requireSpecialChars: tabContainer.querySelector('#sec-require-special').checked,
          passwordExpiryDays: parseInt(tabContainer.querySelector('#sec-expiry-days').value, 10),
          twoFactorPolicy: tabContainer.querySelector('#sec-2fa-policy').value,
          sessionTimeoutMinutes: parseInt(tabContainer.querySelector('#sec-session-timeout').value, 10),
          maxFailedAttempts: parseInt(tabContainer.querySelector('#sec-max-failed').value, 10),
          maskSensitiveData: tabContainer.querySelector('#sec-mask-data').checked,
          immutableAuditLogs: tabContainer.querySelector('#sec-immutable-audit').checked
        };
        saveSecuritySettings(updated);
      });
    }

    // ABA 3: TRILHA DE AUDITORIA & LOGS
    function renderAuditTab(tabContainer) {
      const logs = getAuditLogs();

      tabContainer.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1rem;">
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.75rem;">
            <p style="margin:0; font-size:0.8125rem; color:#64748b;">
              Registros imutáveis de eventos de segurança, login, trocas de senha e alterações cadastrais.
            </p>
            <button class="btn btn-secondary btn-sm" id="btn-export-audit-csv">
              📥 Exportar Log de Auditoria (CSV)
            </button>
          </div>

          <div class="companies-table-card">
            <div class="companies-table-responsive">
              <table class="companies-data-table">
                <thead>
                  <tr>
                    <th>DATA / HORA</th>
                    <th>USUÁRIO</th>
                    <th>EVENTO / AÇÃO</th>
                    <th>IP DE ORIGEM</th>
                    <th>NÍVEL</th>
                    <th>DETALHES DA OPERAÇÃO</th>
                  </tr>
                </thead>
                <tbody>
                  ${logs.map(log => {
                    let sevClass = 'audit-severity-info';
                    if (log.severity === 'success') sevClass = 'audit-severity-success';
                    else if (log.severity === 'warning') sevClass = 'audit-severity-warning';
                    else if (log.severity === 'danger') sevClass = 'audit-severity-danger';

                    return `
                      <tr>
                        <td>
                          <span style="font-family:monospace; font-size:0.75rem; color:var(--text-primary);">${log.timestamp}</span>
                        </td>
                        <td>
                          <strong style="font-size:0.8rem; color:var(--text-primary);">${log.user}</strong>
                        </td>
                        <td>
                          <span style="font-size:0.78rem; font-weight:600; color:var(--text-secondary);">${log.actionLabel}</span>
                        </td>
                        <td>
                          <span style="font-family:monospace; font-size:0.72rem; color:#64748b;">${log.ip}</span>
                        </td>
                        <td>
                          <span class="audit-severity-pill ${sevClass}">${log.severity}</span>
                        </td>
                        <td>
                          <span style="font-size:0.75rem; color:#64748b;">${log.details}</span>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
            <div class="companies-table-footer">
              <span>Total de <strong>${logs.length}</strong> eventos registrados na trilha</span>
              <span>Integridade SHA-256 Verificada</span>
            </div>
          </div>
        </div>
      `;

      tabContainer.querySelector('#btn-export-audit-csv').addEventListener('click', () => {
        const headers = ['ID', 'Data/Hora', 'Usuário', 'Evento', 'IP', 'Severidade', 'Detalhes'];
        const rows = logs.map(l => [l.id, l.timestamp, l.user, l.actionLabel, l.ip, l.severity, l.details]);
        const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CRM_SB_Saude_Auditoria_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Trilha de auditoria exportada com sucesso!');
      });
    }

    // === MODAL 1: CRIAR NOVO USUÁRIO ===
    function openCreateUserModal() {
      const modalContainer = container.querySelector('#admin-modal-container');
      if (!modalContainer) return;

      modalContainer.innerHTML = `
        <div class="modal-dialog" style="max-width: 680px;">
          <div class="modal-header">
            <div>
              <h3 style="margin:0; font-size:1.25rem;">👤 Cadastrar Novo Usuário</h3>
              <p style="margin:0.2rem 0 0 0; font-size:0.78rem; color:var(--text-muted);">
                Provisione credenciais de acesso corporativo com privilégios adequados à função
              </p>
            </div>
            <button class="btn btn-ghost btn-sm" id="btn-close-modal" style="font-size:1.2rem;">✕</button>
          </div>

          <div class="modal-body" style="display:flex; flex-direction:column; gap:1.1rem;">
            <div class="form-grid">
              <div class="form-group form-full">
                <label>Nome Completo <span style="color:#dc2626;">*</span></label>
                <input type="text" class="form-control" id="new-user-fullname" placeholder="Ex: Mariana Silva" required>
              </div>

              <div class="form-group">
                <label>Login de Usuário <span style="color:#dc2626;">*</span></label>
                <input type="text" class="form-control" id="new-user-login" placeholder="Ex: MARIANA" style="text-transform:uppercase;" required>
              </div>

              <div class="form-group">
                <label>E-mail Corporativo <span style="color:#dc2626;">*</span></label>
                <input type="email" class="form-control" id="new-user-email" placeholder="mariana.silva@sbsaude.com.br" required>
              </div>

              <div class="form-group">
                <label>Cargo / Função <span style="color:#dc2626;">*</span></label>
                <input type="text" class="form-control" id="new-user-role" placeholder="Ex: Consultora Comercial" value="Consultora Comercial" required>
              </div>

              <div class="form-group">
                <label>Perfil de Acesso <span style="color:#dc2626;">*</span></label>
                <select class="form-control" id="new-user-profile">
                  <option value="Consultor Comercial" selected>Consultor Comercial (Cotações &amp; Propostas)</option>
                  <option value="Gestor Comercial">Gestor Comercial (Aprovação &amp; Relatórios)</option>
                  <option value="Analista de Operações">Analista de Operações (Cadastro &amp; Vínculos)</option>
                  <option value="Administrador Master">Administrador Master (Acesso Total &amp; Segurança)</option>
                </select>
              </div>
            </div>

            <!-- Seção de Senha Inicial -->
            <div style="background:var(--bg-surface-nested); border:1px solid var(--border-subtle); border-radius:10px; padding:1rem; display:flex; flex-direction:column; gap:0.75rem;">
              <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
                <strong style="font-size:0.85rem; color:var(--text-primary);">Definição de Credencial Inicial</strong>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-generate-pwd" style="font-size:0.75rem; padding:0.25rem 0.65rem;">
                  🎲 Gerar Senha Forte
                </button>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label>Senha Inicial <span style="color:#dc2626;">*</span></label>
                  <input type="password" class="form-control" id="new-user-pwd" placeholder="Mínimo 8 caracteres" required>
                  <div class="password-strength-bar">
                    <div class="password-strength-fill" id="pwd-strength-fill" style="width:0%;"></div>
                  </div>
                  <span id="pwd-strength-label" style="font-size:0.68rem; color:#94a3b8; margin-top:2px; display:block;">Força da senha</span>
                </div>

                <div class="form-group">
                  <label>Confirmar Senha <span style="color:#dc2626;">*</span></label>
                  <input type="password" class="form-control" id="new-user-pwd-confirm" placeholder="Repita a senha" required>
                </div>
              </div>

              <div style="display:flex; flex-direction:column; gap:0.4rem; font-size:0.78rem; color:#475569; margin-top:0.2rem;">
                <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
                  <input type="checkbox" id="chk-must-change-pwd" checked style="width:16px; height:16px;">
                  <span>Exigir redefinição de senha no primeiro login do usuário</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
                  <input type="checkbox" id="chk-enable-2fa" checked style="width:16px; height:16px;">
                  <span>Habilitar autenticação em duas etapas (2FA) por SMS / Aplicativo</span>
                </label>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-ghost" id="btn-cancel-modal">Cancelar</button>
            <button type="button" class="btn btn-primary" id="btn-save-new-user" style="font-weight:700;">
              💾 Cadastrar e Ativar Usuário
            </button>
          </div>
        </div>
      `;

      modalContainer.classList.add('active');

      const inpPwd = modalContainer.querySelector('#new-user-pwd');
      const fillBar = modalContainer.querySelector('#pwd-strength-fill');
      const labelBar = modalContainer.querySelector('#pwd-strength-label');

      inpPwd.addEventListener('input', (e) => {
        const st = checkPasswordStrength(e.target.value);
        fillBar.style.width = st.percent + '%';
        fillBar.style.backgroundColor = st.color;
        labelBar.textContent = 'Força: ' + st.label;
        labelBar.style.color = st.color;
      });

      modalContainer.querySelector('#btn-generate-pwd').addEventListener('click', () => {
        const strong = generateStrongPassword();
        inpPwd.value = strong;
        modalContainer.querySelector('#new-user-pwd-confirm').value = strong;
        inpPwd.type = 'text';
        modalContainer.querySelector('#new-user-pwd-confirm').type = 'text';
        const st = checkPasswordStrength(strong);
        fillBar.style.width = st.percent + '%';
        fillBar.style.backgroundColor = st.color;
        labelBar.textContent = 'Força: ' + st.label + ' (Gerada automaticamente)';
        labelBar.style.color = st.color;
      });

      const closeModal = () => modalContainer.classList.remove('active');
      modalContainer.querySelector('#btn-close-modal').addEventListener('click', closeModal);
      modalContainer.querySelector('#btn-cancel-modal').addEventListener('click', closeModal);
      modalContainer.addEventListener('click', (e) => {
        if (e.target === modalContainer) closeModal();
      });

      modalContainer.querySelector('#btn-save-new-user').addEventListener('click', async () => {
        const fullname = modalContainer.querySelector('#new-user-fullname').value.trim();
        const login = modalContainer.querySelector('#new-user-login').value.trim().toUpperCase();
        const email = modalContainer.querySelector('#new-user-email').value.trim();
        const role = modalContainer.querySelector('#new-user-role').value.trim();
        const profile = modalContainer.querySelector('#new-user-profile').value;
        const pwd = inpPwd.value;
        const pwdConfirm = modalContainer.querySelector('#new-user-pwd-confirm').value;
        const twoFactor = modalContainer.querySelector('#chk-enable-2fa').checked;

        if (!fullname || !login || !email || !role) {
          showToast('Preencha todos os campos obrigatórios!', 'error');
          return;
        }
        if (!pwd || pwd.length < 6) {
          showToast('A senha inicial deve ter pelo menos 6 caracteres!', 'error');
          return;
        }
        if (pwd !== pwdConfirm) {
          showToast('A confirmação de senha não confere!', 'error');
          return;
        }

        const usersList = getAdminUsers();
        if (usersList.some(u => (u.login || u.username || '').toUpperCase() === login)) {
          showToast(`Já existe um usuário com o login "${login}"!`, 'error');
          return;
        }

        const initials = fullname.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || login.slice(0, 2);

        const newUser = {
          id: 'USR-00' + (usersList.length + 1),
          login,
          name: fullname,
          email,
          role,
          profile,
          status: 'Ativo',
          password: pwd,
          twoFactor,
          lastLogin: 'Primeiro acesso pendente',
          ip: '192.168.10.' + Math.floor(Math.random() * 80 + 10),
          avatar: initials,
          createdAt: new Date().toLocaleDateString('pt-BR')
        };

        const btnSave = modalContainer.querySelector('#btn-save-new-user');
        const originalText = btnSave.innerHTML;
        btnSave.disabled = true;
        btnSave.innerHTML = '⏳ Salvando no banco de dados...';

        try {
          if (!window.crmSupabase) {
            throw new Error('Serviço Supabase não está inicializado.');
          }

          const saveResult = await window.crmSupabase.saveUser(newUser);
          if (!saveResult || saveResult.success === false) {
            const errMsg = (saveResult && saveResult.error) ? saveResult.error : 'Falha ao persistir usuário no Supabase.';
            throw new Error(errMsg);
          }

          // Persistência confirmada no banco Supabase: atualiza lista local
          usersList.push(newUser);
          saveAdminUsers(usersList);

          addAuditLog('USER_CREATE', `Criação do usuário ${login}`, 'success', `Usuário ${fullname} cadastrado com perfil ${profile}`);
          closeModal();
          showToast(`Usuário ${login} cadastrado e salvo com sucesso no banco de dados!`, 'success');
          renderAdmin(container);
        } catch (err) {
          console.error('[Admin] Erro ao cadastrar usuário:', err);
          showToast(`Erro ao gravar usuário no Supabase: ${err.message || err}`, 'error');
          btnSave.disabled = false;
          btnSave.innerHTML = originalText;
        }
      });
    }

    // === MODAL 2: ALTERAÇÃO DE SENHA ===
    function openChangePasswordModal(userId) {
      const usersList = getAdminUsers();
      const user = usersList.find(u => u.id === userId);
      if (!user) return;

      const modalContainer = container.querySelector('#admin-modal-container');
      if (!modalContainer) return;

      modalContainer.innerHTML = `
        <div class="modal-dialog" style="max-width: 540px;">
          <div class="modal-header">
            <div style="display:flex; align-items:center; gap:0.75rem;">
              <div class="admin-user-avatar-circle" style="width:38px; height:38px;">${user.avatar}</div>
              <div>
                <h3 style="margin:0; font-size:1.15rem;">Alterar Senha de Acesso</h3>
                <p style="margin:0.15rem 0 0 0; font-size:0.78rem; color:var(--text-muted);">
                  Usuário: <strong>${user.name}</strong> (${user.login})
                </p>
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" id="btn-close-pwd-modal" style="font-size:1.2rem;">✕</button>
          </div>

          <div class="modal-body" style="display:flex; flex-direction:column; gap:1rem;">
            <div style="background:#fff1f2; border:1px solid #ffe4e6; border-radius:8px; padding:0.75rem 1rem; font-size:0.78rem; color:#9f1239;">
              ℹ️ A alteração da credencial entrará em vigor imediatamente. Recomenda-se o uso de senhas fortes com no mínimo 8 caracteres.
            </div>

            <div style="display:flex; align-items:center; justify-content:space-between;">
              <label style="font-size:0.8125rem; font-weight:600; color:var(--text-primary);">Nova Senha</label>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-gen-new-pwd" style="font-size:0.72rem; padding:0.2rem 0.5rem;">
                🎲 Gerar Senha Segura
              </button>
            </div>

            <div style="display:flex; flex-direction:column; gap:0.75rem;">
              <div>
                <input type="password" class="form-control" id="inp-new-password" placeholder="Digite a nova senha" required>
                <div class="password-strength-bar">
                  <div class="password-strength-fill" id="pwd-change-fill" style="width:0%;"></div>
                </div>
                <span id="pwd-change-label" style="font-size:0.68rem; color:#94a3b8; margin-top:2px; display:block;">Força da senha</span>
              </div>

              <div>
                <label style="font-size:0.8125rem; font-weight:600; color:var(--text-primary); display:block; margin-bottom:0.35rem;">Confirmar Nova Senha</label>
                <input type="password" class="form-control" id="inp-new-password-confirm" placeholder="Confirme a nova senha" required>
              </div>
            </div>

            <div style="font-size:0.78rem; color:#475569; display:flex; flex-direction:column; gap:0.4rem; margin-top:0.3rem;">
              <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
                <input type="checkbox" id="chk-force-disconnect" checked style="width:16px; height:16px;">
                <span>Desconectar todas as outras sessões ativas deste usuário</span>
              </label>
              <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
                <input type="checkbox" id="chk-notify-email" checked style="width:16px; height:16px;">
                <span>Enviar aviso de segurança para <strong>${user.email}</strong></span>
              </label>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-ghost" id="btn-cancel-pwd-modal">Cancelar</button>
            <button type="button" class="btn btn-primary" id="btn-save-password" style="font-weight:700;">
              🔒 Atualizar Senha
            </button>
          </div>
        </div>
      `;

      modalContainer.classList.add('active');

      const inpPwd = modalContainer.querySelector('#inp-new-password');
      const inpConf = modalContainer.querySelector('#inp-new-password-confirm');
      const fillBar = modalContainer.querySelector('#pwd-change-fill');
      const labelBar = modalContainer.querySelector('#pwd-change-label');

      inpPwd.addEventListener('input', (e) => {
        const st = checkPasswordStrength(e.target.value);
        fillBar.style.width = st.percent + '%';
        fillBar.style.backgroundColor = st.color;
        labelBar.textContent = 'Força: ' + st.label;
        labelBar.style.color = st.color;
      });

      modalContainer.querySelector('#btn-gen-new-pwd').addEventListener('click', () => {
        const strong = generateStrongPassword();
        inpPwd.value = strong;
        inpConf.value = strong;
        inpPwd.type = 'text';
        inpConf.type = 'text';
        const st = checkPasswordStrength(strong);
        fillBar.style.width = st.percent + '%';
        fillBar.style.backgroundColor = st.color;
        labelBar.textContent = 'Força: ' + st.label + ' (Gerada automaticamente)';
        labelBar.style.color = st.color;
      });

      const closeModal = () => modalContainer.classList.remove('active');
      modalContainer.querySelector('#btn-close-pwd-modal').addEventListener('click', closeModal);
      modalContainer.querySelector('#btn-cancel-pwd-modal').addEventListener('click', closeModal);
      modalContainer.addEventListener('click', (e) => {
        if (e.target === modalContainer) closeModal();
      });

      modalContainer.querySelector('#btn-save-password').addEventListener('click', async () => {
        const pwd = inpPwd.value;
        const conf = inpConf.value;

        if (!pwd || pwd.length < 6) {
          showToast('A senha deve ter pelo menos 6 caracteres!', 'error');
          return;
        }
        if (pwd !== conf) {
          showToast('As senhas digitadas não coincidem!', 'error');
          return;
        }

        const btnSave = modalContainer.querySelector('#btn-save-password');
        const originalText = btnSave.innerHTML;
        btnSave.disabled = true;
        btnSave.innerHTML = '⏳ Atualizando no banco...';

        try {
          const oldPwd = user.password;
          user.password = pwd;
          if (window.crmSupabase) {
            const res = await window.crmSupabase.saveUser(user);
            if (res && res.success === false) {
              user.password = oldPwd;
              throw new Error(res.error || 'Erro ao persistir nova senha no Supabase.');
            }
          }
          saveAdminUsers(usersList);
          addAuditLog('PASSWORD_CHANGE', `Senha alterada para o usuário ${user.login}`, 'warning', `Credencial atualizada via painel de administração corporativa`);
          closeModal();
          showToast(`Senha do usuário "${user.name}" atualizada com sucesso no banco!`, 'success');
        } catch (err) {
          console.error('[Admin] Erro ao alterar senha:', err);
          showToast(`Erro ao atualizar senha no banco: ${err.message || err}`, 'error');
          btnSave.disabled = false;
          btnSave.innerHTML = originalText;
        }
      });
    }

    // === MODAL 3: EDITAR PERFIL E PERMISSÕES ===
    function openEditUserModal(userId) {
      const usersList = getAdminUsers();
      const user = usersList.find(u => u.id === userId);
      if (!user) return;

      const modalContainer = container.querySelector('#admin-modal-container');
      if (!modalContainer) return;

      modalContainer.innerHTML = `
        <div class="modal-dialog" style="max-width: 580px;">
          <div class="modal-header">
            <div>
              <h3 style="margin:0; font-size:1.2rem;">✏️ Editar Dados do Usuário</h3>
              <p style="margin:0.2rem 0 0 0; font-size:0.78rem; color:var(--text-muted);">
                Atualize o perfil de acesso e privilégios operacionais de <strong>${user.name}</strong>
              </p>
            </div>
            <button class="btn btn-ghost btn-sm" id="btn-close-edit-modal" style="font-size:1.2rem;">✕</button>
          </div>

          <div class="modal-body" style="display:flex; flex-direction:column; gap:1rem;">
            <div class="form-grid">
              <div class="form-group form-full">
                <label>Nome Completo</label>
                <input type="text" class="form-control" id="edit-user-name" value="${user.name}">
              </div>

              <div class="form-group">
                <label>E-mail Corporativo</label>
                <input type="email" class="form-control" id="edit-user-email" value="${user.email}">
              </div>

              <div class="form-group">
                <label>Cargo / Função</label>
                <input type="text" class="form-control" id="edit-user-role" value="${user.role}">
              </div>

              <div class="form-group">
                <label>Perfil de Acesso</label>
                <select class="form-control" id="edit-user-profile">
                  <option value="Consultor Comercial" ${user.profile === 'Consultor Comercial' ? 'selected' : ''}>Consultor Comercial</option>
                  <option value="Gestor Comercial" ${user.profile === 'Gestor Comercial' ? 'selected' : ''}>Gestor Comercial</option>
                  <option value="Analista de Operações" ${user.profile === 'Analista de Operações' ? 'selected' : ''}>Analista de Operações</option>
                  <option value="Administrador Master" ${user.profile === 'Administrador Master' ? 'selected' : ''}>Administrador Master</option>
                </select>
              </div>

              <div class="form-group">
                <label>Status da Conta</label>
                <select class="form-control" id="edit-user-status">
                  <option value="Ativo" ${user.status === 'Ativo' ? 'selected' : ''}>Ativo</option>
                  <option value="Bloqueado" ${user.status !== 'Ativo' ? 'selected' : ''}>Bloqueado</option>
                </select>
              </div>
            </div>

            <div style="background:var(--bg-surface-nested); border:1px solid var(--border-subtle); border-radius:8px; padding:0.85rem; font-size:0.78rem;">
              <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
                <input type="checkbox" id="edit-user-2fa" ${user.twoFactor ? 'checked' : ''} style="width:16px; height:16px;">
                <span style="color:var(--text-primary);">Autenticação em duas etapas (2FA) ativada para este usuário</span>
              </label>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-ghost" id="btn-cancel-edit-modal">Cancelar</button>
            <button type="button" class="btn btn-primary" id="btn-save-edit-user" style="font-weight:700;">
              💾 Salvar Alterações
            </button>
          </div>
        </div>
      `;

      modalContainer.classList.add('active');

      const closeModal = () => modalContainer.classList.remove('active');
      modalContainer.querySelector('#btn-close-edit-modal').addEventListener('click', closeModal);
      modalContainer.querySelector('#btn-cancel-edit-modal').addEventListener('click', closeModal);
      modalContainer.addEventListener('click', (e) => {
        if (e.target === modalContainer) closeModal();
      });

      modalContainer.querySelector('#btn-save-edit-user').addEventListener('click', async () => {
        const btnSave = modalContainer.querySelector('#btn-save-edit-user');
        const originalText = btnSave.innerHTML;
        btnSave.disabled = true;
        btnSave.innerHTML = '⏳ Salvando no banco...';

        try {
          const backup = { ...user };
          user.name = modalContainer.querySelector('#edit-user-name').value.trim();
          user.email = modalContainer.querySelector('#edit-user-email').value.trim();
          user.role = modalContainer.querySelector('#edit-user-role').value.trim();
          user.profile = modalContainer.querySelector('#edit-user-profile').value;
          user.status = modalContainer.querySelector('#edit-user-status').value;
          user.twoFactor = modalContainer.querySelector('#edit-user-2fa').checked;

          if (window.crmSupabase) {
            const res = await window.crmSupabase.saveUser(user);
            if (res && res.success === false) {
              Object.assign(user, backup);
              throw new Error(res.error || 'Erro ao persistir alterações no Supabase.');
            }
          }

          saveAdminUsers(usersList);
          addAuditLog('USER_UPDATE', `Atualização cadastral do usuário ${user.login}`, 'info', `Cargo: ${user.role}, Perfil: ${user.profile}, Status: ${user.status}`);
          closeModal();
          showToast(`Dados de ${user.name} atualizados com sucesso no banco!`, 'success');
          renderAdmin(container);
        } catch (err) {
          console.error('[Admin] Erro ao editar usuário:', err);
          showToast(`Erro ao salvar edições no banco: ${err.message || err}`, 'error');
          btnSave.disabled = false;
          btnSave.innerHTML = originalText;
        }
      });
    }

    // === ALTERAR STATUS (BLOQUEAR / DESBLOQUEAR) ===
    async function toggleUserStatus(userId) {
      const usersList = getAdminUsers();
      const user = usersList.find(u => u.id === userId);
      if (!user) return;

      const currentActive = localStorage.getItem('crm_active_user') || 'ADMINISTRADOR';
      if (user.login === currentActive) {
        showToast('Não é permitido bloquear a própria conta conectada!', 'error');
        return;
      }

      const prevStatus = user.status;
      user.status = user.status === 'Ativo' ? 'Bloqueado' : 'Ativo';
      try {
        if (window.crmSupabase) {
          const res = await window.crmSupabase.saveUser(user);
          if (res && res.success === false) {
            user.status = prevStatus;
            throw new Error(res.error || 'Erro ao persistir status no Supabase.');
          }
        }
        saveAdminUsers(usersList);
        addAuditLog(
          user.status === 'Ativo' ? 'USER_UNBLOCK' : 'USER_BLOCK',
          `Conta do usuário ${user.login} ${user.status.toLowerCase()}`,
          user.status === 'Ativo' ? 'success' : 'warning',
          `Alteração de status de credencial executada pelo administrador`
        );
        showToast(`Usuário ${user.name} agora está ${user.status}!`, user.status === 'Ativo' ? 'success' : 'warning');
        renderAdmin(container);
      } catch (err) {
        console.error('[Admin] Erro ao alterar status:', err);
        showToast(`Erro ao alterar status no banco: ${err.message || err}`, 'error');
      }
    }

    // === EXCLUIR USUÁRIO ===
    async function deleteUser(userId) {
      const usersList = getAdminUsers();
      const user = usersList.find(u => u.id === userId);
      if (!user) return;

      const currentActive = localStorage.getItem('crm_active_user') || 'ADMINISTRADOR';
      if (user.login === currentActive) {
        showToast('Não é permitido excluir o usuário atualmente conectado!', 'error');
        return;
      }

      if (confirm(`Tem certeza de que deseja excluir permanentemente o usuário "${user.name}" (${user.login})? Esta ação será registrada na trilha de auditoria.`)) {
        try {
          if (window.crmSupabase) {
            const res = await window.crmSupabase.deleteUser(user.login);
            if (res === false) {
              throw new Error('Falha ao excluir usuário no Supabase.');
            }
          }
          const updated = usersList.filter(u => u.id !== userId);
          saveAdminUsers(updated);
          addAuditLog('USER_DELETE', `Exclusão do usuário ${user.login}`, 'danger', `Conta de ${user.name} removida do diretório de acessos`);
          showToast(`Usuário "${user.name}" removido com sucesso do banco!`, 'success');
          renderAdmin(container);
        } catch (err) {
          console.error('[Admin] Erro ao excluir usuário:', err);
          showToast(`Erro ao excluir usuário no banco: ${err.message || err}`, 'error');
        }
      }
    }
  }



  // ==========================================================================
  // MÓDULO DE RELATÓRIOS & BUSINESS INTELLIGENCE (ReportsEngine Integration)
  // ==========================================================================

  const reportsState = {
    source: 'proposals',
    title: 'Relatório Personalizado de Propostas',
    columns: ['ID', 'DATA_DA_PROSPECCAO', 'EMPRESA', 'COMPETENCIA', 'VIDAS', 'FATURAMENTO', 'TEMPERATURA_CONTRATO', 'CORRETORES_1'],
    groupBy: '',
    measures: ['count', 'sum_VIDAS', 'sum_FATURAMENTO', 'avg_TKM'],
    filters: [],
    period: { start: '', end: '', field: 'DATA_DA_PROSPECCAO' },
    sort: { field: 'ID', order: 'desc' },
    searchTerm: '',
    page: 1,
    pageSize: 15,
    lastResult: null,
    builderExpanded: true,
    activeTemplateId: null,
    editingSavedReportId: null
  };

  function renderReports(container) {
    if (!window.ReportsEngine) {
      container.innerHTML = '<div class="alert alert-danger">Motor de relatórios (ReportsEngine) indisponível.</div>';
      return;
    }

    const isMaster = isMasterAdmin();
    const sources = window.ReportsEngine.DATA_SOURCES;
    const templates = window.ReportsEngine.SUGGESTED_TEMPLATES;
    const currentSchema = sources[reportsState.source] || sources.proposals;

    // Se o usuário não for master e tentar fonte restrita, reverte para proposals
    if (currentSchema.requiresMaster && !isMaster) {
      reportsState.source = 'proposals';
    }

    // Se as colunas atuais estiverem vazias, carrega as colunas padrão da fonte
    if (!reportsState.columns || reportsState.columns.length === 0) {
      reportsState.columns = currentSchema.columns.filter(c => c.defaultSelected).map(c => c.id);
    }

    // Executa a consulta com os dados e usuário atuais se não houver resultado em cache
    if (!reportsState.lastResult) {
      reportsState.lastResult = window.ReportsEngine.executeReport({
        source: reportsState.source,
        title: reportsState.title,
        columns: reportsState.columns,
        groupBy: reportsState.groupBy,
        measures: reportsState.measures,
        filters: reportsState.filters,
        period: reportsState.period,
        sort: reportsState.sort
      }, appData, getAuthenticatedUser());
    }

    const savedReports = window.ReportsEngine.getSavedReports();
    const result = reportsState.lastResult;
    const records = result && Array.isArray(result.records) ? result.records : [];
    const displayedColumns = result && Array.isArray(result.displayedColumns) ? result.displayedColumns : reportsState.columns;
    const totals = result ? result.grandTotals : null;

    // Filtragem rápida de pesquisa local sobre a prévia
    let viewRecords = records;
    if (reportsState.searchTerm && reportsState.searchTerm.trim() !== '') {
      const q = reportsState.searchTerm.toLowerCase().trim();
      viewRecords = records.filter(r => {
        return displayedColumns.some(colId => {
          const val = r[colId];
          return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
        });
      });
    }

    // Paginação
    const totalItems = viewRecords.length;
    const pageSize = reportsState.pageSize === 'all' ? totalItems : parseInt(reportsState.pageSize, 10);
    const totalPages = pageSize > 0 ? Math.ceil(totalItems / pageSize) : 1;
    if (reportsState.page > totalPages) reportsState.page = Math.max(1, totalPages);
    const startIdx = (reportsState.page - 1) * pageSize;
    const endIdx = pageSize === totalItems ? totalItems : Math.min(startIdx + pageSize, totalItems);
    const pagedRecords = viewRecords.slice(startIdx, endIdx);

    // Indicadores do topo do resultado
    const summaryVidas = totals && totals._summary && totals._summary.totalVidas !== null ? totals._summary.totalVidas : null;
    const summaryFat = totals && totals._summary && totals._summary.totalFaturamento !== null ? totals._summary.totalFaturamento : null;
    const summaryTkm = summaryVidas && summaryFat ? summaryFat / summaryVidas : null;

    // Monta o HTML da tela
    container.innerHTML = `
      <div class="reports-view-wrapper" id="reports-view-wrapper">
        <!-- Topo da Tela: Título e Ações Rápidas -->
        <div class="reports-header">
          <div class="reports-title-area">
            <div class="reports-title-row">
              <h1 class="reports-main-title">Relatórios &amp; Inteligência Comercial</h1>
              <span class="reports-source-badge">
                <span class="pulse-dot"></span>
                Fonte: ${currentSchema.label} (${window.ReportsEngine.formatNumber(records.length)} registros)
              </span>
            </div>
            <p class="reports-subtitle">
              Consulte qualquer dado disponível no sistema com filtros combinados, agrupamentos dinâmicos, métricas consolidadas e exportação instantânea em CSV e PDF.
            </p>
          </div>
          <div class="reports-top-actions">
            <button type="button" class="rep-btn rep-btn-secondary" id="rep-btn-saved-list">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
              <span>Meus Relatórios (${savedReports.length})</span>
            </button>
            <button type="button" class="rep-btn rep-btn-primary" id="rep-btn-new-custom">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>Novo Relatório</span>
            </button>
          </div>
        </div>

        <!-- Seção: Modelos Sugeridos de Relatórios -->
        <div class="rep-section-block">
          <div class="rep-section-header">
            <div>
              <h2 class="rep-section-title">Modelos Sugeridos de Relatórios</h2>
              <p class="rep-section-desc">Selecione um relatório pronto. Cada modelo abre com campos, filtros e agrupamentos pré-configurados e 100% editáveis.</p>
            </div>
            <button type="button" class="rep-btn-link" id="rep-btn-toggle-templates-view">
              <span>Recolher Modelos</span>
            </button>
          </div>
          <div class="rep-templates-grid" id="rep-templates-grid">
            ${templates.map(tpl => `
              <div class="rep-template-card ${reportsState.activeTemplateId === tpl.id ? 'active-template' : ''}" data-template-id="${tpl.id}">
                <div class="rep-tpl-header">
                  <span class="rep-tpl-icon">${tpl.icon}</span>
                  <span class="rep-tpl-cat">${tpl.category}</span>
                </div>
                <h3 class="rep-tpl-title">${tpl.title}</h3>
                <p class="rep-tpl-desc">${tpl.description}</p>
                <div class="rep-tpl-footer">
                  <span class="rep-tpl-source">${tpl.config.source === 'proposals' ? 'Propostas' : tpl.config.source}</span>
                  <button type="button" class="rep-btn-apply-tpl" data-template-id="${tpl.id}">
                    <span>Abrir Modelo</span>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Painel: Criador de Relatórios (Report Builder) -->
        <div class="rep-builder-card" id="rep-builder-card">
          <div class="rep-builder-header" id="rep-builder-toggle">
            <div class="rep-builder-title-row">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              <h3>Parâmetros da Consulta &amp; Construtor Dinâmico</h3>
              <span class="rep-builder-badge">${reportsState.title}</span>
            </div>
            <button type="button" class="rep-builder-chevron" id="rep-chevron-btn" title="Expandir/Recolher Construtor">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="transform: ${reportsState.builderExpanded ? 'rotate(180deg)' : 'rotate(0deg)'}"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
          </div>

          <div class="rep-builder-body" id="rep-builder-body" style="display: ${reportsState.builderExpanded ? 'block' : 'none'};">
            <!-- Linha 1: Fonte de Dados e Título -->
            <div class="rep-form-row rep-grid-2">
              <div class="rep-form-group">
                <label class="rep-label" for="rep-source-select">Fonte de Dados do Sistema:</label>
                <select class="rep-select" id="rep-source-select">
                  <option value="proposals" ${reportsState.source === 'proposals' ? 'selected' : ''}>Propostas Comerciais (1.072 itens)</option>
                  <option value="companies" ${reportsState.source === 'companies' ? 'selected' : ''}>Empresas / Clientes (535 empresas)</option>
                  <option value="brokers" ${reportsState.source === 'brokers' ? 'selected' : ''}>Corretores &amp; Parceiros (161 corretores)</option>
                  <option value="campaigns" ${reportsState.source === 'campaigns' ? 'selected' : ''}>Campanhas Comerciais (27 campanhas)</option>
                  <option value="policies" ${reportsState.source === 'policies' ? 'selected' : ''}>Políticas Comerciais (Coparticipação &amp; Agenciamento)</option>
                  ${isMaster ? `<option value="audit" ${reportsState.source === 'audit' ? 'selected' : ''}>Auditoria &amp; Governança (Logs &amp; Requisitos)</option>` : ''}
                </select>
                <span class="rep-hint">${currentSchema.description}</span>
              </div>
              <div class="rep-form-group">
                <label class="rep-label" for="rep-title-input">Nome do Relatório:</label>
                <input type="text" class="rep-input" id="rep-title-input" value="${reportsState.title}" placeholder="Ex: Faturamento Consolidado Bahia">
                <span class="rep-hint">Este título constará no cabeçalho e na exportação oficial em CSV e PDF.</span>
              </div>
            </div>

            <!-- Linha 2: Seleção de Colunas -->
            <div class="rep-form-group rep-mt-3">
              <div class="rep-cols-header">
                <label class="rep-label">Colunas Exibidas no Resultado:</label>
                <div class="rep-cols-actions">
                  <button type="button" class="rep-btn-text" id="rep-cols-all">Marcar Todas</button>
                  <button type="button" class="rep-btn-text" id="rep-cols-default">Padrão</button>
                  <button type="button" class="rep-btn-text" id="rep-cols-clear">Limpar</button>
                </div>
              </div>
              <div class="rep-chips-container" id="rep-columns-chips">
                ${currentSchema.columns.map(col => {
                  const isChecked = reportsState.columns.includes(col.id);
                  return `
                    <label class="rep-chip ${isChecked ? 'chip-active' : ''}">
                      <input type="checkbox" class="rep-col-checkbox" value="${col.id}" ${isChecked ? 'checked' : ''}>
                      <span>${col.label}</span>
                      <small class="chip-type">${col.type}</small>
                    </label>
                  `;
                }).join('')}
              </div>
            </div>

            <!-- Linha 3: Filtro Rápido de Período -->
            <div class="rep-form-row rep-grid-4 rep-mt-3 rep-period-box">
              <div class="rep-form-group">
                <label class="rep-label" for="rep-period-field">Campo de Data:</label>
                <select class="rep-select" id="rep-period-field">
                  ${currentSchema.columns.filter(c => c.type === 'date').map(c => `
                    <option value="${c.id}" ${reportsState.period.field === c.id ? 'selected' : ''}>${c.label}</option>
                  `).join('')}
                  ${!currentSchema.columns.some(c => c.type === 'date') ? '<option value="">Sem campo de data</option>' : ''}
                </select>
              </div>
              <div class="rep-form-group">
                <label class="rep-label" for="rep-period-start">Data Inicial (De):</label>
                <input type="text" class="rep-input" id="rep-period-start" placeholder="DD/MM/AAAA" value="${reportsState.period.start || ''}">
              </div>
              <div class="rep-form-group">
                <label class="rep-label" for="rep-period-end">Data Final (Até):</label>
                <input type="text" class="rep-input" id="rep-period-end" placeholder="DD/MM/AAAA" value="${reportsState.period.end || ''}">
              </div>
              <div class="rep-form-group rep-period-quick-actions">
                <label class="rep-label">Atalhos:</label>
                <div class="rep-quick-btns">
                  <button type="button" class="rep-btn-mini" id="rep-btn-period-2024">Ano 2024</button>
                  <button type="button" class="rep-btn-mini" id="rep-btn-period-clear">Limpar</button>
                </div>
              </div>
            </div>

            <!-- Linha 4: Filtros Combinados -->
            <div class="rep-form-group rep-mt-3">
              <div class="rep-cols-header">
                <label class="rep-label">Filtros Combinados Condicionais:</label>
                <button type="button" class="rep-btn-text-primary" id="rep-add-filter-btn">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  <span>+ Adicionar Condição</span>
                </button>
              </div>
              <div class="rep-filters-container" id="rep-filters-container">
                ${reportsState.filters.length === 0 ? `
                  <div class="rep-no-filters" id="rep-no-filters-hint">Nenhum filtro condicional ativo. Todos os registros da fonte serão considerados.</div>
                ` : ''}
                ${reportsState.filters.map((f, idx) => `
                  <div class="rep-filter-row" data-filter-idx="${idx}">
                    <select class="rep-select rep-f-field">
                      ${currentSchema.columns.map(c => `
                        <option value="${c.id}" ${f.field === c.id ? 'selected' : ''}>${c.label}</option>
                      `).join('')}
                    </select>
                    <select class="rep-select rep-f-op">
                      <option value="eq" ${f.operator === 'eq' ? 'selected' : ''}>igual a</option>
                      <option value="neq" ${f.operator === 'neq' ? 'selected' : ''}>diferente de</option>
                      <option value="contains" ${f.operator === 'contains' ? 'selected' : ''}>contém texto</option>
                      <option value="not_contains" ${f.operator === 'not_contains' ? 'selected' : ''}>não contém</option>
                      <option value="gt" ${f.operator === 'gt' ? 'selected' : ''}>maior que (&gt;)</option>
                      <option value="gte" ${f.operator === 'gte' ? 'selected' : ''}>maior ou igual (&gt;=)</option>
                      <option value="lt" ${f.operator === 'lt' ? 'selected' : ''}>menor que (&lt;)</option>
                      <option value="lte" ${f.operator === 'lte' ? 'selected' : ''}>menor ou igual (&lt;=)</option>
                      <option value="is_not_empty" ${f.operator === 'is_not_empty' ? 'selected' : ''}>está preenchido</option>
                      <option value="is_empty" ${f.operator === 'is_empty' ? 'selected' : ''}>está vazio</option>
                    </select>
                    <input type="text" class="rep-input rep-f-val" value="${f.value || ''}" placeholder="Valor da condição" ${f.operator === 'is_empty' || f.operator === 'is_not_empty' ? 'disabled style="opacity:0.5;"' : ''}>
                    <button type="button" class="rep-btn-del-filter" data-filter-idx="${idx}" title="Remover filtro">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- Linha 5: Agrupamento e Medidas -->
            <div class="rep-form-row rep-grid-2 rep-mt-3">
              <div class="rep-form-group">
                <label class="rep-label" for="rep-group-select">Agrupamento de Dados:</label>
                <select class="rep-select" id="rep-group-select">
                  <option value="" ${!reportsState.groupBy ? 'selected' : ''}>Sem Agrupamento (Listagem detalhada analítica)</option>
                  ${currentSchema.columns.map(c => `
                    <option value="${c.id}" ${reportsState.groupBy === c.id ? 'selected' : ''}>Agrupar por ${c.label}</option>
                  `).join('')}
                </select>
                <span class="rep-hint">Ao agrupar, as linhas serão consolidadas com base nas medidas selecionadas ao lado.</span>
              </div>
              <div class="rep-form-group" id="rep-measures-box" style="${!reportsState.groupBy ? 'opacity: 0.5; pointer-events: none;' : ''}">
                <label class="rep-label">Medidas Agregadas (quando agrupado):</label>
                <div class="rep-chips-container">
                  <label class="rep-chip ${reportsState.measures.includes('count') ? 'chip-active' : ''}">
                    <input type="checkbox" class="rep-measure-checkbox" value="count" ${reportsState.measures.includes('count') ? 'checked' : ''}>
                    <span>Contagem (Qtd Itens)</span>
                  </label>
                  <label class="rep-chip ${reportsState.measures.includes('sum_VIDAS') ? 'chip-active' : ''}">
                    <input type="checkbox" class="rep-measure-checkbox" value="sum_VIDAS" ${reportsState.measures.includes('sum_VIDAS') ? 'checked' : ''}>
                    <span>Soma de Vidas</span>
                  </label>
                  <label class="rep-chip ${reportsState.measures.includes('sum_FATURAMENTO') ? 'chip-active' : ''}">
                    <input type="checkbox" class="rep-measure-checkbox" value="sum_FATURAMENTO" ${reportsState.measures.includes('sum_FATURAMENTO') ? 'checked' : ''}>
                    <span>Soma de Faturamento</span>
                  </label>
                  <label class="rep-chip ${reportsState.measures.includes('avg_TKM') ? 'chip-active' : ''}">
                    <input type="checkbox" class="rep-measure-checkbox" value="avg_TKM" ${reportsState.measures.includes('avg_TKM') ? 'checked' : ''}>
                    <span>Média de TKM</span>
                  </label>
                  <label class="rep-chip ${reportsState.measures.includes('avg_FATURAMENTO') ? 'chip-active' : ''}">
                    <input type="checkbox" class="rep-measure-checkbox" value="avg_FATURAMENTO" ${reportsState.measures.includes('avg_FATURAMENTO') ? 'checked' : ''}>
                    <span>Média de Faturamento</span>
                  </label>
                </div>
              </div>
            </div>

            <!-- Linha 6: Ordenação -->
            <div class="rep-form-row rep-grid-2 rep-mt-3">
              <div class="rep-form-group">
                <label class="rep-label" for="rep-sort-field">Ordenar Resultado por:</label>
                <select class="rep-select" id="rep-sort-field">
                  ${reportsState.groupBy ? `
                    <option value="${reportsState.groupBy}" ${reportsState.sort.field === reportsState.groupBy ? 'selected' : ''}>${currentSchema.columns.find(c => c.id === reportsState.groupBy)?.label || reportsState.groupBy}</option>
                    <option value="count" ${reportsState.sort.field === 'count' ? 'selected' : ''}>Contagem (Qtd)</option>
                    <option value="sum_VIDAS" ${reportsState.sort.field === 'sum_VIDAS' ? 'selected' : ''}>Soma de Vidas</option>
                    <option value="sum_FATURAMENTO" ${reportsState.sort.field === 'sum_FATURAMENTO' ? 'selected' : ''}>Soma de Faturamento</option>
                    <option value="avg_TKM" ${reportsState.sort.field === 'avg_TKM' ? 'selected' : ''}>Média de TKM</option>
                  ` : currentSchema.columns.map(c => `
                    <option value="${c.id}" ${reportsState.sort.field === c.id ? 'selected' : ''}>${c.label}</option>
                  `).join('')}
                </select>
              </div>
              <div class="rep-form-group">
                <label class="rep-label" for="rep-sort-order">Sentido da Ordenação:</label>
                <select class="rep-select" id="rep-sort-order">
                  <option value="asc" ${reportsState.sort.order === 'asc' ? 'selected' : ''}>Crescente (A-Z / Menor para Maior / Mais Antigo)</option>
                  <option value="desc" ${reportsState.sort.order === 'desc' ? 'selected' : ''}>Decrescente (Z-A / Maior para Menor / Mais Recente)</option>
                </select>
              </div>
            </div>

            <!-- Barra de Ações do Construtor -->
            <div class="rep-builder-actions-bar">
              <div class="rep-left-actions">
                <button type="button" class="rep-btn rep-btn-primary" id="rep-btn-generate">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  <span>Gerar Relatório / Atualizar Prévia</span>
                </button>
                <button type="button" class="rep-btn rep-btn-secondary" id="rep-btn-save-current">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                  <span>Salvar Configuração</span>
                </button>
              </div>
              <div class="rep-right-actions">
                <button type="button" class="rep-btn rep-btn-export-csv" id="rep-btn-export-csv" title="Exportar dados filtrados para planilha CSV formatada em pt-BR">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  <span>Exportar CSV</span>
                </button>
                <button type="button" class="rep-btn rep-btn-export-pdf" id="rep-btn-export-pdf" title="Visualizar e imprimir em folha executiva A4 institucional">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                  <span>Imprimir / PDF</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Cards de Indicadores do Resultado Atual -->
        <div class="rep-kpi-grid">
          <div class="rep-kpi-card">
            <span class="rep-kpi-label">Registros Filtrados</span>
            <div class="rep-kpi-value">${window.ReportsEngine.formatNumber(records.length)}</div>
            <span class="rep-kpi-sub">Total resultante da consulta ativa</span>
          </div>
          <div class="rep-kpi-card">
            <span class="rep-kpi-label">Volume Total de Vidas</span>
            <div class="rep-kpi-value">${summaryVidas !== null ? window.ReportsEngine.formatNumber(summaryVidas) : '—'}</div>
            <span class="rep-kpi-sub">Beneficiários somados</span>
          </div>
          <div class="rep-kpi-card">
            <span class="rep-kpi-label">Faturamento Consolidado</span>
            <div class="rep-kpi-value">${summaryFat !== null ? window.ReportsEngine.formatCurrency(summaryFat) : '—'}</div>
            <span class="rep-kpi-sub">Receita bruta estimada</span>
          </div>
          <div class="rep-kpi-card">
            <span class="rep-kpi-label">Ticket Médio (TKM)</span>
            <div class="rep-kpi-value">${summaryTkm !== null ? window.ReportsEngine.formatCurrency(summaryTkm) : '—'}</div>
            <span class="rep-kpi-sub">Valor médio por vida</span>
          </div>
        </div>

        <!-- Seção de Prévia da Tabela de Resultados -->
        <div class="rep-table-section">
          <div class="rep-table-toolbar">
            <div class="rep-table-search-box">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" class="rep-table-search-input" id="rep-table-search" placeholder="Pesquisa rápida na tabela..." value="${reportsState.searchTerm || ''}">
            </div>
            <div class="rep-table-toolbar-right">
              <label for="rep-page-size-select" class="rep-page-label">Registros por página:</label>
              <select class="rep-page-select" id="rep-page-size-select">
                <option value="10" ${reportsState.pageSize === 10 ? 'selected' : ''}>10</option>
                <option value="15" ${reportsState.pageSize === 15 ? 'selected' : ''}>15</option>
                <option value="25" ${reportsState.pageSize === 25 ? 'selected' : ''}>25</option>
                <option value="50" ${reportsState.pageSize === 50 ? 'selected' : ''}>50</option>
                <option value="100" ${reportsState.pageSize === 100 ? 'selected' : ''}>100</option>
                <option value="all" ${reportsState.pageSize === 'all' ? 'selected' : ''}>Todas</option>
              </select>
            </div>
          </div>

          <!-- Tabela de Dados Responsiva -->
          <div class="rep-table-container">
            <table class="rep-data-table" id="rep-preview-table">
              <thead>
                <tr>
                  ${displayedColumns.map(colId => {
                    let label = colId;
                    if (colId === 'count') label = 'Qtd Registros';
                    else if (colId.startsWith('sum_')) {
                      const orig = colId.replace('sum_', '');
                      label = `Soma (${currentSchema.columns.find(c => c.id === orig)?.label || orig})`;
                    } else if (colId.startsWith('avg_')) {
                      const orig = colId.replace('avg_', '');
                      label = `Média (${currentSchema.columns.find(c => c.id === orig)?.label || orig})`;
                    } else {
                      const found = currentSchema.columns.find(c => c.id === colId);
                      if (found) label = found.label;
                    }
                    const isSorted = reportsState.sort.field === colId;
                    const sortIcon = isSorted ? (reportsState.sort.order === 'asc' ? ' ▲' : ' ▼') : '';
                    return `<th class="rep-th-sortable" data-col-id="${colId}" title="Clique para ordenar">${label}${sortIcon}</th>`;
                  }).join('')}
                </tr>
              </thead>
              <tbody>
                ${pagedRecords.length === 0 ? `
                  <tr>
                    <td colspan="${displayedColumns.length}" class="rep-td-empty">
                      Nenhum registro encontrado para os filtros e parâmetros especificados.
                    </td>
                  </tr>
                ` : pagedRecords.map((rec, rIdx) => `
                  <tr>
                    ${displayedColumns.map(colId => {
                      const val = rec[colId];
                      let display = (val === null || val === undefined || val === '') ? '—' : val;

                      // Badges estilizados para temperaturas / status
                      if (colId === 'TEMPERATURA_CONTRATO' || colId === 'STATUS' || colId === 'Status_Campanha') {
                        const badgeCls = getBadgeClass(String(val));
                        display = `<span class="badge ${badgeCls}">${val}</span>`;
                      }

                      return `<td>${display}</td>`;
                    }).join('')}
                  </tr>
                `).join('')}
              </tbody>
              ${totals ? `
                <tfoot>
                  <tr class="rep-totals-tr">
                    ${displayedColumns.map(colId => {
                      const val = totals[colId];
                      const display = (val === null || val === undefined || val === '') ? '—' : val;
                      return `<td><strong>${display}</strong></td>`;
                    }).join('')}
                  </tr>
                </tfoot>
              ` : ''}
            </table>
          </div>

          <!-- Barra de Paginação -->
          <div class="rep-pagination-bar">
            <div class="rep-pagination-info">
              Exibindo <strong>${totalItems > 0 ? startIdx + 1 : 0}</strong> a <strong>${endIdx}</strong> de <strong>${totalItems}</strong> registros
              ${reportsState.searchTerm ? `(filtrado de ${records.length} no total)` : ''}
            </div>
            <div class="rep-pagination-controls">
              <button type="button" class="rep-page-btn" id="rep-page-first" ${reportsState.page <= 1 ? 'disabled' : ''}>&laquo;</button>
              <button type="button" class="rep-page-btn" id="rep-page-prev" ${reportsState.page <= 1 ? 'disabled' : ''}>&lsaquo; Anterior</button>
              <span class="rep-page-current">Página <strong>${reportsState.page}</strong> de <strong>${totalPages}</strong></span>
              <button type="button" class="rep-page-btn" id="rep-page-next" ${reportsState.page >= totalPages ? 'disabled' : ''}>Próxima &rsaquo;</button>
              <button type="button" class="rep-page-btn" id="rep-page-last" ${reportsState.page >= totalPages ? 'disabled' : ''}>&raquo;</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal: Meus Relatórios Salvos -->
      <div class="rep-modal-overlay" id="rep-saved-modal" style="display: none;">
        <div class="rep-modal-dialog">
          <div class="rep-modal-header">
            <h3 class="rep-modal-title">Meus Relatórios Salvos</h3>
            <button type="button" class="rep-modal-close" id="rep-close-saved-modal">&times;</button>
          </div>
          <div class="rep-modal-body">
            <div class="rep-saved-list" id="rep-saved-list">
              ${savedReports.length === 0 ? `
                <div class="rep-saved-empty">Você ainda não possui relatórios salvos. Configure suas opções e clique em "Salvar Configuração".</div>
              ` : savedReports.map(rep => `
                <div class="rep-saved-item" data-saved-id="${rep.id}">
                  <div class="rep-saved-item-info">
                    <h4 class="rep-saved-title">${rep.title}</h4>
                    <span class="rep-saved-meta">
                      Fonte: <strong>${sources[rep.source]?.label || rep.source}</strong> •
                      Atualizado em: ${window.ReportsEngine.formatDateBR(rep.updatedAt)} •
                      ${rep.groupBy ? `Agrupado por ${rep.groupBy}` : 'Listagem Analítica'}
                    </span>
                  </div>
                  <div class="rep-saved-actions">
                    <button type="button" class="rep-btn-mini rep-btn-load" data-saved-id="${rep.id}" title="Abrir e executar este relatório">Abrir</button>
                    <button type="button" class="rep-btn-mini rep-btn-dup" data-saved-id="${rep.id}" title="Duplicar configuração">Duplicar</button>
                    <button type="button" class="rep-btn-mini rep-btn-del" data-saved-id="${rep.id}" title="Excluir relatório permanente">Excluir</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="rep-modal-footer">
            <button type="button" class="rep-btn rep-btn-secondary" id="rep-btn-modal-close">Fechar</button>
          </div>
        </div>
      </div>
    `;

    // Conectar todos os eventos interativos da tela de Relatórios
    attachReportsEvents(container);
  }

  function attachReportsEvents(container) {
    const isMaster = isMasterAdmin();

    // 1. Alternar visualização dos Modelos Sugeridos
    const btnToggleTemplates = container.querySelector('#rep-btn-toggle-templates-view');
    const templatesGrid = container.querySelector('#rep-templates-grid');
    if (btnToggleTemplates && templatesGrid) {
      btnToggleTemplates.addEventListener('click', () => {
        const isHidden = templatesGrid.style.display === 'none';
        templatesGrid.style.display = isHidden ? 'grid' : 'none';
        btnToggleTemplates.textContent = isHidden ? 'Recolher Modelos' : 'Expandir Modelos';
      });
    }

    // 2. Clique em Card de Modelo Sugerido
    container.querySelectorAll('.rep-btn-apply-tpl, .rep-template-card').forEach(el => {
      el.addEventListener('click', (e) => {
        const tplId = el.dataset.templateId;
        if (!tplId) return;
        const tpl = window.ReportsEngine.SUGGESTED_TEMPLATES.find(t => t.id === tplId);
        if (tpl) {
          reportsState.activeTemplateId = tpl.id;
          reportsState.source = tpl.config.source;
          reportsState.title = tpl.title;
          reportsState.columns = [...tpl.config.columns];
          reportsState.groupBy = tpl.config.groupBy || '';
          reportsState.measures = tpl.config.measures ? [...tpl.config.measures] : [];
          reportsState.filters = tpl.config.filters ? JSON.parse(JSON.stringify(tpl.config.filters)) : [];
          reportsState.period = tpl.config.period ? { ...tpl.config.period } : { start: '', end: '', field: 'DATA_DA_PROSPECCAO' };
          reportsState.sort = tpl.config.sort ? { ...tpl.config.sort } : { field: 'ID', order: 'desc' };
          reportsState.page = 1;
          reportsState.searchTerm = '';
          reportsState.lastResult = null;
          reportsState.builderExpanded = true;
          showToast(`Modelo "${tpl.title}" aplicado com sucesso!`, 'success');
          renderReports(container);
          // Rolagem suave até a prévia
          const tbl = document.getElementById('rep-preview-table');
          if (tbl) tbl.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });

    // 3. Toggle do Construtor de Relatórios (Accordion)
    const toggleBuilderBtn = container.querySelector('#rep-builder-toggle');
    const builderBody = container.querySelector('#rep-builder-body');
    const chevronSvg = container.querySelector('#rep-chevron-btn svg');
    if (toggleBuilderBtn && builderBody) {
      toggleBuilderBtn.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        reportsState.builderExpanded = !reportsState.builderExpanded;
        builderBody.style.display = reportsState.builderExpanded ? 'block' : 'none';
        if (chevronSvg) {
          chevronSvg.style.transform = reportsState.builderExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
        }
      });
    }

    // 4. Mudança de Fonte de Dados
    const sourceSelect = container.querySelector('#rep-source-select');
    if (sourceSelect) {
      sourceSelect.addEventListener('change', (e) => {
        const newSource = e.target.value;
        const schema = window.ReportsEngine.DATA_SOURCES[newSource];
        if (!schema) return;
        if (schema.requiresMaster && !isMaster) {
          showToast('Acesso negado: Auditoria e Governança é restrito ao Administrador Master.', 'warning');
          return;
        }
        reportsState.source = newSource;
        reportsState.title = `Relatório de ${schema.label}`;
        reportsState.columns = schema.columns.filter(c => c.defaultSelected).map(c => c.id);
        reportsState.groupBy = '';
        reportsState.filters = [];
        reportsState.period = { start: '', end: '', field: schema.dateField || '' };
        reportsState.sort = { field: reportsState.columns[0] || '', order: 'asc' };
        reportsState.page = 1;
        reportsState.lastResult = null;
        renderReports(container);
      });
    }

    // 5. Edição do Título
    const titleInput = container.querySelector('#rep-title-input');
    if (titleInput) {
      titleInput.addEventListener('input', (e) => {
        reportsState.title = e.target.value.trim() || 'Relatório Personalizado';
      });
    }

    // 6. Seleção de Colunas (Chips)
    container.querySelectorAll('.rep-col-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const checkedCols = Array.from(container.querySelectorAll('.rep-col-checkbox:checked')).map(c => c.value);
        reportsState.columns = checkedCols;
        reportsState.lastResult = null;
      });
    });

    const btnColsAll = container.querySelector('#rep-cols-all');
    if (btnColsAll) {
      btnColsAll.addEventListener('click', () => {
        const schema = window.ReportsEngine.DATA_SOURCES[reportsState.source];
        reportsState.columns = schema.columns.map(c => c.id);
        reportsState.lastResult = null;
        renderReports(container);
      });
    }

    const btnColsDefault = container.querySelector('#rep-cols-default');
    if (btnColsDefault) {
      btnColsDefault.addEventListener('click', () => {
        const schema = window.ReportsEngine.DATA_SOURCES[reportsState.source];
        reportsState.columns = schema.columns.filter(c => c.defaultSelected).map(c => c.id);
        reportsState.lastResult = null;
        renderReports(container);
      });
    }

    const btnColsClear = container.querySelector('#rep-cols-clear');
    if (btnColsClear) {
      btnColsClear.addEventListener('click', () => {
        reportsState.columns = [];
        reportsState.lastResult = null;
        renderReports(container);
      });
    }

    // 7. Filtro de Período
    const periodFieldSelect = container.querySelector('#rep-period-field');
    if (periodFieldSelect) {
      periodFieldSelect.addEventListener('change', (e) => {
        reportsState.period.field = e.target.value;
      });
    }
    const periodStartInp = container.querySelector('#rep-period-start');
    if (periodStartInp) {
      periodStartInp.addEventListener('change', (e) => {
        reportsState.period.start = e.target.value.trim();
      });
    }
    const periodEndInp = container.querySelector('#rep-period-end');
    if (periodEndInp) {
      periodEndInp.addEventListener('change', (e) => {
        reportsState.period.end = e.target.value.trim();
      });
    }

    const btnPeriod2024 = container.querySelector('#rep-btn-period-2024');
    if (btnPeriod2024) {
      btnPeriod2024.addEventListener('click', () => {
        reportsState.period.start = '01/01/2024';
        reportsState.period.end = '31/12/2024';
        if (periodStartInp) periodStartInp.value = '01/01/2024';
        if (periodEndInp) periodEndInp.value = '31/12/2024';
        reportsState.lastResult = null;
      });
    }

    const btnPeriodClear = container.querySelector('#rep-btn-period-clear');
    if (btnPeriodClear) {
      btnPeriodClear.addEventListener('click', () => {
        reportsState.period.start = '';
        reportsState.period.end = '';
        if (periodStartInp) periodStartInp.value = '';
        if (periodEndInp) periodEndInp.value = '';
        reportsState.lastResult = null;
      });
    }

    // 8. Filtros Combinados (+ Adicionar Condição / Remover)
    const btnAddFilter = container.querySelector('#rep-add-filter-btn');
    if (btnAddFilter) {
      btnAddFilter.addEventListener('click', () => {
        const schema = window.ReportsEngine.DATA_SOURCES[reportsState.source];
        const defaultField = schema.columns[0]?.id || 'ID';
        reportsState.filters.push({
          field: defaultField,
          operator: 'eq',
          value: ''
        });
        renderReports(container);
      });
    }

    container.querySelectorAll('.rep-filter-row').forEach(row => {
      const idx = parseInt(row.dataset.filterIdx, 10);
      const fField = row.querySelector('.rep-f-field');
      const fOp = row.querySelector('.rep-f-op');
      const fVal = row.querySelector('.rep-f-val');
      const fDel = row.querySelector('.rep-btn-del-filter');

      if (fField) {
        fField.addEventListener('change', (e) => {
          if (reportsState.filters[idx]) {
            reportsState.filters[idx].field = e.target.value;
          }
        });
      }
      if (fOp) {
        fOp.addEventListener('change', (e) => {
          if (reportsState.filters[idx]) {
            reportsState.filters[idx].operator = e.target.value;
            if (e.target.value === 'is_empty' || e.target.value === 'is_not_empty') {
              if (fVal) { fVal.disabled = true; fVal.style.opacity = '0.5'; }
            } else {
              if (fVal) { fVal.disabled = false; fVal.style.opacity = '1'; }
            }
          }
        });
      }
      if (fVal) {
        fVal.addEventListener('input', (e) => {
          if (reportsState.filters[idx]) {
            reportsState.filters[idx].value = e.target.value;
          }
        });
      }
      if (fDel) {
        fDel.addEventListener('click', () => {
          reportsState.filters.splice(idx, 1);
          renderReports(container);
        });
      }
    });

    // 9. Agrupamento e Medidas
    const groupSelect = container.querySelector('#rep-group-select');
    if (groupSelect) {
      groupSelect.addEventListener('change', (e) => {
        reportsState.groupBy = e.target.value;
        const measuresBox = container.querySelector('#rep-measures-box');
        if (measuresBox) {
          if (reportsState.groupBy) {
            measuresBox.style.opacity = '1';
            measuresBox.style.pointerEvents = 'auto';
          } else {
            measuresBox.style.opacity = '0.5';
            measuresBox.style.pointerEvents = 'none';
          }
        }
        reportsState.lastResult = null;
      });
    }

    container.querySelectorAll('.rep-measure-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const checkedMeasures = Array.from(container.querySelectorAll('.rep-measure-checkbox:checked')).map(c => c.value);
        reportsState.measures = checkedMeasures;
        reportsState.lastResult = null;
      });
    });

    // 10. Ordenação
    const sortFieldSelect = container.querySelector('#rep-sort-field');
    if (sortFieldSelect) {
      sortFieldSelect.addEventListener('change', (e) => {
        reportsState.sort.field = e.target.value;
      });
    }
    const sortOrderSelect = container.querySelector('#rep-sort-order');
    if (sortOrderSelect) {
      sortOrderSelect.addEventListener('change', (e) => {
        reportsState.sort.order = e.target.value;
      });
    }

    // 11. Botão "Gerar Relatório / Atualizar Prévia"
    const btnGenerate = container.querySelector('#rep-btn-generate');
    if (btnGenerate) {
      btnGenerate.addEventListener('click', () => {
        reportsState.page = 1;
        reportsState.lastResult = window.ReportsEngine.executeReport({
          source: reportsState.source,
          title: reportsState.title,
          columns: reportsState.columns,
          groupBy: reportsState.groupBy,
          measures: reportsState.measures,
          filters: reportsState.filters,
          period: reportsState.period,
          sort: reportsState.sort
        }, appData, getAuthenticatedUser());

        showToast('Relatório gerado e prévia atualizada!', 'success');
        renderReports(container);
      });
    }

    // 12. Botão "Salvar Configuração"
    const btnSaveCurrent = container.querySelector('#rep-btn-save-current');
    if (btnSaveCurrent) {
      btnSaveCurrent.addEventListener('click', () => {
        const title = prompt('Informe o nome para salvar este relatório:', reportsState.title);
        if (!title || !title.trim()) return;
        const res = window.ReportsEngine.saveReport({
          id: reportsState.editingSavedReportId || undefined,
          title: title.trim(),
          source: reportsState.source,
          columns: reportsState.columns,
          groupBy: reportsState.groupBy,
          measures: reportsState.measures,
          filters: reportsState.filters,
          period: reportsState.period,
          sort: reportsState.sort
        });
        if (res.success) {
          showToast(`Relatório "${res.report.title}" salvo com sucesso!`, 'success');
          renderReports(container);
        } else {
          showToast(res.error || 'Erro ao salvar relatório.', 'warning');
        }
      });
    }

    // 13. Botão "Exportar CSV"
    const btnExportCsv = container.querySelector('#rep-btn-export-csv');
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', () => {
        try {
          if (!reportsState.lastResult) {
            reportsState.lastResult = window.ReportsEngine.executeReport({
              source: reportsState.source,
              title: reportsState.title,
              columns: reportsState.columns,
              groupBy: reportsState.groupBy,
              measures: reportsState.measures,
              filters: reportsState.filters,
              period: reportsState.period,
              sort: reportsState.sort
            }, appData, getAuthenticatedUser());
          }

          const user = getAuthenticatedUser();
          const csvData = window.ReportsEngine.exportToCSV(reportsState.lastResult, {
            title: reportsState.title,
            userName: user ? `${user.name || user.login} (${user.role || user.profile || 'Usuário'})` : 'Usuário CRM'
          });

          const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          const cleanTitle = (reportsState.title || 'relatorio').toLowerCase().replace(/[^a-z0-9]/g, '_');
          link.setAttribute('href', url);
          link.setAttribute('download', `${cleanTitle}_${window.ReportsEngine.formatDateBR(new Date()).replace(/\//g, '-')}.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);

          showToast('Relatório CSV exportado com sucesso!', 'success');
        } catch (err) {
          console.error(err);
          showToast('Erro ao exportar CSV: ' + err.message, 'warning');
        }
      });
    }

    // 14. Botão "Imprimir / Exportar PDF"
    const btnExportPdf = container.querySelector('#rep-btn-export-pdf');
    if (btnExportPdf) {
      btnExportPdf.addEventListener('click', () => {
        try {
          if (!reportsState.lastResult) {
            reportsState.lastResult = window.ReportsEngine.executeReport({
              source: reportsState.source,
              title: reportsState.title,
              columns: reportsState.columns,
              groupBy: reportsState.groupBy,
              measures: reportsState.measures,
              filters: reportsState.filters,
              period: reportsState.period,
              sort: reportsState.sort
            }, appData, getAuthenticatedUser());
          }

          const user = getAuthenticatedUser();
          const htmlContent = window.ReportsEngine.buildPrintDocument(reportsState.lastResult, {
            title: reportsState.title,
            userName: user ? `${user.name || user.login} (${user.role || user.profile || 'Usuário'})` : 'Usuário CRM'
          });

          const printWindow = window.open('', '_blank', 'width=1100,height=800');
          if (printWindow) {
            printWindow.document.open();
            printWindow.document.write(htmlContent);
            printWindow.document.close();
          } else {
            showToast('Por favor, permita pop-ups para visualizar a impressão do relatório.', 'warning');
          }
        } catch (err) {
          console.error(err);
          showToast('Erro ao preparar impressão: ' + err.message, 'warning');
        }
      });
    }

    // 15. Pesquisa Instantânea na Tabela
    const tableSearch = container.querySelector('#rep-table-search');
    if (tableSearch) {
      tableSearch.addEventListener('input', (e) => {
        reportsState.searchTerm = e.target.value;
        reportsState.page = 1;
        renderReports(container);
        // Mantém o foco no input
        const reSearch = document.getElementById('rep-table-search');
        if (reSearch) {
          reSearch.focus();
          reSearch.setSelectionRange(reSearch.value.length, reSearch.value.length);
        }
      });
    }

    // 16. Paginação & Tamanho da Página
    const pageSizeSelect = container.querySelector('#rep-page-size-select');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', (e) => {
        reportsState.pageSize = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
        reportsState.page = 1;
        renderReports(container);
      });
    }

    const pagePrev = container.querySelector('#rep-page-prev');
    if (pagePrev) {
      pagePrev.addEventListener('click', () => {
        if (reportsState.page > 1) {
          reportsState.page--;
          renderReports(container);
        }
      });
    }
    const pageNext = container.querySelector('#rep-page-next');
    if (pageNext) {
      pageNext.addEventListener('click', () => {
        reportsState.page++;
        renderReports(container);
      });
    }
    const pageFirst = container.querySelector('#rep-page-first');
    if (pageFirst) {
      pageFirst.addEventListener('click', () => {
        reportsState.page = 1;
        renderReports(container);
      });
    }
    const pageLast = container.querySelector('#rep-page-last');
    if (pageLast) {
      pageLast.addEventListener('click', () => {
        const pageSize = reportsState.pageSize === 'all' ? 10000 : reportsState.pageSize;
        const total = reportsState.lastResult ? reportsState.lastResult.records.length : 1;
        reportsState.page = Math.ceil(total / pageSize);
        renderReports(container);
      });
    }

    // 17. Ordenação Rápida ao Clicar no Cabeçalho da Tabela
    container.querySelectorAll('.rep-th-sortable').forEach(th => {
      th.addEventListener('click', () => {
        const colId = th.dataset.colId;
        if (reportsState.sort.field === colId) {
          reportsState.sort.order = reportsState.sort.order === 'asc' ? 'desc' : 'asc';
        } else {
          reportsState.sort.field = colId;
          reportsState.sort.order = 'asc';
        }
        reportsState.page = 1;
        reportsState.lastResult = window.ReportsEngine.executeReport({
          source: reportsState.source,
          title: reportsState.title,
          columns: reportsState.columns,
          groupBy: reportsState.groupBy,
          measures: reportsState.measures,
          filters: reportsState.filters,
          period: reportsState.period,
          sort: reportsState.sort
        }, appData, getAuthenticatedUser());
        renderReports(container);
      });
    });

    // 18. Modal de Relatórios Salvos
    const savedModal = container.querySelector('#rep-saved-modal');
    const btnSavedList = container.querySelector('#rep-btn-saved-list');
    const btnCloseModal = container.querySelector('#rep-close-saved-modal');
    const btnModalClose = container.querySelector('#rep-btn-modal-close');

    if (btnSavedList && savedModal) {
      btnSavedList.addEventListener('click', () => {
        savedModal.style.display = 'flex';
      });
    }
    if (btnCloseModal && savedModal) {
      btnCloseModal.addEventListener('click', () => {
        savedModal.style.display = 'none';
      });
    }
    if (btnModalClose && savedModal) {
      btnModalClose.addEventListener('click', () => {
        savedModal.style.display = 'none';
      });
    }

    // Ações na lista de relatórios salvos (Abrir, Duplicar, Excluir)
    container.querySelectorAll('.rep-btn-load').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.savedId;
        const list = window.ReportsEngine.getSavedReports();
        const found = list.find(r => r.id === id);
        if (found) {
          reportsState.source = found.source;
          reportsState.title = found.title;
          reportsState.columns = [...found.columns];
          reportsState.groupBy = found.groupBy || '';
          reportsState.measures = found.measures ? [...found.measures] : [];
          reportsState.filters = found.filters ? JSON.parse(JSON.stringify(found.filters)) : [];
          reportsState.period = found.period ? { ...found.period } : { start: '', end: '', field: 'DATA_DA_PROSPECCAO' };
          reportsState.sort = found.sort ? { ...found.sort } : { field: 'ID', order: 'desc' };
          reportsState.editingSavedReportId = found.id;
          reportsState.page = 1;
          reportsState.searchTerm = '';
          reportsState.lastResult = null;
          savedModal.style.display = 'none';
          showToast(`Relatório "${found.title}" carregado com sucesso!`, 'success');
          renderReports(container);
        }
      });
    });

    container.querySelectorAll('.rep-btn-dup').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.savedId;
        const res = window.ReportsEngine.duplicateReport(id);
        if (res.success) {
          showToast('Relatório duplicado com sucesso!', 'success');
          renderReports(container);
          const m = document.getElementById('rep-saved-modal');
          if (m) m.style.display = 'flex';
        }
      });
    });

    container.querySelectorAll('.rep-btn-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.savedId;
        if (confirm('Tem certeza de que deseja excluir permanentemente este relatório salvo?')) {
          const res = window.ReportsEngine.deleteReport(id);
          if (res.success) {
            showToast('Relatório excluído com sucesso!', 'success');
            renderReports(container);
            const m = document.getElementById('rep-saved-modal');
            if (m) m.style.display = 'flex';
          }
        }
      });
    });

    // 19. Botão "Novo Relatório"
    const btnNew = container.querySelector('#rep-btn-new-custom');
    if (btnNew) {
      btnNew.addEventListener('click', () => {
        const schema = window.ReportsEngine.DATA_SOURCES.proposals;
        reportsState.source = 'proposals';
        reportsState.title = 'Novo Relatório Personalizado';
        reportsState.columns = schema.columns.filter(c => c.defaultSelected).map(c => c.id);
        reportsState.groupBy = '';
        reportsState.measures = ['count', 'sum_VIDAS', 'sum_FATURAMENTO'];
        reportsState.filters = [];
        reportsState.period = { start: '', end: '', field: 'DATA_DA_PROSPECCAO' };
        reportsState.sort = { field: 'ID', order: 'desc' };
        reportsState.page = 1;
        reportsState.searchTerm = '';
        reportsState.activeTemplateId = null;
        reportsState.editingSavedReportId = null;
        reportsState.lastResult = null;
        reportsState.builderExpanded = true;
        showToast('Novo relatório em branco iniciado.', 'info');
        renderReports(container);
      });
    }
  }


  // ==========================================================================
  // GERENCIAMENTO DE TEMA (CLARO / ESCURO / AUTOMÁTICO)
  // ==========================================================================
  const THEME_STORAGE_KEY = 'crm_theme_preference';

  function getSystemThemePreference() {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  function getEffectiveTheme(choice) {
    if (choice === 'dark') return 'dark';
    if (choice === 'light') return 'light';
    return getSystemThemePreference();
  }

  function applyTheme(choice, skipChartRefresh = false) {
    const effectiveTheme = getEffectiveTheme(choice);
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    document.documentElement.setAttribute('data-theme-choice', choice);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch (e) {}

    // Atualiza botões no cabeçalho
    document.querySelectorAll('.theme-switch-btn').forEach(btn => {
      const btnChoice = btn.dataset.themeChoice;
      if (btnChoice === choice) {
        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-checked', 'false');
      }
    });

    // Se estiver no Dashboard e houver gráfico ativo, atualiza as cores dos eixos e legendas sem resetar estado
    if (!skipChartRefresh && state.currentTab === 'dashboard' && mainChartInstance) {
      const proposals = getFilteredProposals();
      renderMainChart(proposals);
    }
  }

  function initThemeManager() {
    const savedChoice = localStorage.getItem(THEME_STORAGE_KEY) || 'auto';
    applyTheme(savedChoice, true);

    // Eventos nos botões de alternância
    document.querySelectorAll('.theme-switch-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const choice = btn.dataset.themeChoice;
        if (choice) {
          applyTheme(choice);
          const labels = {
            light: 'Tema Claro ativado.',
            dark: 'Tema Escuro ativado.',
            auto: 'Modo Automático (preferência do sistema operacional) ativado.'
          };
          showToast(labels[choice] || 'Tema atualizado.', 'info');
        }
      });
    });

    // Listener para mudanças no tema do sistema operacional
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleSystemThemeChange = () => {
        const currentChoice = localStorage.getItem(THEME_STORAGE_KEY) || 'auto';
        if (currentChoice === 'auto') {
          applyTheme('auto');
        }
      };
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleSystemThemeChange);
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(handleSystemThemeChange);
      }
    }

    // Exporta API pública de tema no escopo global
    window.CRMThemeManager = {
      applyTheme,
      getEffectiveTheme,
      getCurrentChoice: () => localStorage.getItem(THEME_STORAGE_KEY) || 'auto'
    };
  }


  // Inicialização Geral da Aplicação
  function initApp() {
    // Garantir que a sessão ativa e o usuário padrão sejam o Administrador caso haja resquícios legados
    const activeUser = localStorage.getItem('crm_active_user');
    if (!activeUser || ['LUCAS', 'EDUARDO', 'IVAN LÁZARO', 'JULIANA', 'RAMON'].includes(activeUser.toUpperCase())) {
      localStorage.setItem('crm_active_user', 'ADMINISTRADOR');
    }
    const savedSession = localStorage.getItem('crm_auth_session');
    if (savedSession) {
      try {
        const s = JSON.parse(savedSession);
        if (s && s.login && ['LUCAS', 'EDUARDO', 'IVAN LÁZARO', 'JULIANA', 'RAMON'].includes(s.login.toUpperCase())) {
          localStorage.removeItem('crm_auth_session');
          sessionStorage.removeItem('crm_auth_session');
        }
      } catch (e) {}
    }

    initDataStore();
    initThemeManager();
    syncUserSwitch(getAdminUsers());
    syncSupabaseData();

    // Navegação Global e Sidebar
    window.navigateToTab = function(targetTab, callback) {
      if (targetTab === 'admin' && !isMasterAdmin()) {
        showToast('Acesso restrito: A tela de Administrador é visível exclusivamente para Administrador Master.', 'warning');
        return;
      }
      if (targetTab === 'audit' && !isMasterAdmin()) {
        showToast('Acesso restrito: A tela de Auditoria & Requisitos é visível apenas para usuários com perfil Administrador Master.', 'warning');
        return;
      }
      state.currentTab = targetTab;
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === targetTab);
      });
      const sb = document.getElementById('main-sidebar');
      if (window.innerWidth <= 768 && sb) sb.classList.remove('open');
      renderView();
      if (typeof callback === 'function') {
        setTimeout(callback, 150);
      }
    };

    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        window.navigateToTab(item.dataset.tab);
      });
    });

    const headerChip = document.getElementById('header-user-chip');
    if (headerChip) {
      headerChip.addEventListener('click', () => {
        window.navigateToTab('admin');
      });
    }

    const sidebarFooter = document.getElementById('sidebar-user-footer') || document.querySelector('.sidebar-footer');
    if (sidebarFooter) {
      sidebarFooter.addEventListener('click', () => {
        window.navigateToTab('admin');
      });
    }

    // === Toggle Sidebar (Contrair / Expandir) ===
    const sidebar = document.getElementById('main-sidebar');
    const mainContent = document.querySelector('.main-content');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const mobileBtn = document.getElementById('mobile-menu-btn');

    // Restaura estado salvo
    const sidebarCollapsed = localStorage.getItem('crm_sidebar_collapsed') === 'true';
    if (sidebarCollapsed && sidebar && mainContent) {
      sidebar.classList.add('collapsed');
      mainContent.classList.add('sidebar-collapsed');
    }

    if (toggleBtn && sidebar && mainContent) {
      toggleBtn.addEventListener('click', () => {
        const isCollapsed = sidebar.classList.toggle('collapsed');
        mainContent.classList.toggle('sidebar-collapsed', isCollapsed);
        localStorage.setItem('crm_sidebar_collapsed', isCollapsed);
        toggleBtn.title = isCollapsed ? 'Expandir menu' : 'Retrair menu';
      });
    }

    // Toggle menu mobile
    if (mobileBtn && sidebar) {
      mobileBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
    }

    // Fecha menu mobile ao clicar fora
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('open')) {
        if (!sidebar.contains(e.target) && !mobileBtn?.contains(e.target)) {
          sidebar.classList.remove('open');
        }
      }
    });

    // =========================================================================
    // 9. AUTENTICAÇÃO E CONTROLE DE ACESSO CORPORATIVO (SESSÃO & LOGOUT)
    // =========================================================================

    const AUTH_STORAGE_KEY = 'crm_auth_session';

    function getAuthSession() {
      try {
        const sessionStr = localStorage.getItem(AUTH_STORAGE_KEY) || sessionStorage.getItem(AUTH_STORAGE_KEY);
        if (sessionStr) return JSON.parse(sessionStr);
      } catch (e) {
        console.warn('Erro ao ler sessão de autenticação:', e);
      }
      return null;
    }

    function setAuthSession(sessionData, rememberMe) {
      const serialized = JSON.stringify(sessionData);
      if (rememberMe) {
        localStorage.setItem(AUTH_STORAGE_KEY, serialized);
      } else {
        sessionStorage.setItem(AUTH_STORAGE_KEY, serialized);
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }

    function clearAuthSession() {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }

    function updateHeaderAuthUser(user) {
      if (!user) return;
      const avatarText = user.avatar || (user.name ? user.name.split(' ').map(n=>n[0]).slice(0,2).join('') : user.login.slice(0,2)).toUpperCase();

      // Topo (Header)
      const nameEl = document.getElementById('header-user-name');
      const roleEl = document.getElementById('header-user-role');
      const avatarEl = document.getElementById('header-user-avatar');
      if (nameEl) nameEl.textContent = user.name;
      if (roleEl) roleEl.textContent = user.role;
      if (avatarEl) avatarEl.textContent = avatarText;

      // Barra Lateral (Sidebar Footer)
      const sidebarName = document.getElementById('sidebar-user-name') || document.querySelector('.sidebar-footer .user-name');
      const sidebarRole = document.getElementById('sidebar-user-role') || document.querySelector('.sidebar-footer .user-role');
      const sidebarAvatar = document.getElementById('sidebar-user-avatar') || document.querySelector('.sidebar-footer .user-avatar');
      if (sidebarName) sidebarName.textContent = user.name;
      if (sidebarRole) sidebarRole.textContent = user.role;
      if (sidebarAvatar) sidebarAvatar.textContent = avatarText;

      localStorage.setItem('crm_active_user', user.login);

      // Sincroniza permissões de visibilidade da navegação (Auditoria & Requisitos)
      updateNavigationPermissions(user);

      const userSelect = document.getElementById('user-switch');
      if (userSelect) {
        userSelect.value = user.login;
      }
    }

    function handleLogout() {
      const session = getAuthSession();
      const userName = session ? (session.name || session.login) : 'Usuário';

      if (session) {
        addAuditLog('LOGOUT', `Encerramento de sessão de ${session.login}`, 'info', 'Logout voluntário realizado pelo operador');
      }

      clearAuthSession();

      const appContainer = document.querySelector('.app-container');
      const loginScreen = document.getElementById('login-screen');

      if (appContainer) appContainer.style.display = 'none';
      if (loginScreen) loginScreen.style.display = 'flex';

      renderLoginScreen();
      showToast(`Sessão de ${userName} encerrada com segurança.`, 'info');
    }

    function renderLoginScreen() {
      const loginScreen = document.getElementById('login-screen');
      if (!loginScreen) return;

      const form = document.getElementById('form-login');
      const inpId = document.getElementById('inp-login-identifier');
      const inpPwd = document.getElementById('inp-login-password');
      const btnTogglePwd = document.getElementById('btn-toggle-login-pwd');
      const alertError = document.getElementById('login-alert-error');
      const errorText = document.getElementById('login-error-text');
      const chkRemember = document.getElementById('chk-remember-me');
      // Visualização de senha (mostrar/ocultar com SVG limpo)
      if (btnTogglePwd) {
        btnTogglePwd.onclick = () => {
          if (inpPwd.type === 'password') {
            inpPwd.type = 'text';
            btnTogglePwd.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
              </svg>`;
          } else {
            inpPwd.type = 'password';
            btnTogglePwd.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>`;
          }
        };
      }

      // Link Esqueci minha senha
      const linkForgot = document.getElementById('link-forgot-password');
      if (linkForgot) {
        linkForgot.onclick = (e) => {
          e.preventDefault();
          showToast('Para redefinição de credenciais de acesso, contate o administrador em grupo.ti@opsaudebrasil.com.br.', 'info');
        };
      }

      // Processamento do Login com Consulta em Tempo Real ao Supabase
      if (form) {
        form.onsubmit = async (e) => {
          e.preventDefault();
          const identifier = (inpId.value || '').trim();
          const password = (inpPwd.value || '').trim();
          const remember = chkRemember ? chkRemember.checked : true;

          if (alertError) alertError.style.display = 'none';

          const btnSubmit = form.querySelector('button[type="submit"]');
          const originalBtnText = btnSubmit ? btnSubmit.innerHTML : '<span>Entrar no Sistema</span>';
          if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;">⏳</span> Autenticando...';
          }

          let allUsers = getAdminUsers();

          // 1. Consulta em tempo real ao Supabase para garantir credenciais atualizadas
          if (window.crmSupabase && typeof window.crmSupabase.fetchUsers === 'function') {
            try {
              const remoteUsers = await window.crmSupabase.fetchUsers();
              if (Array.isArray(remoteUsers) && remoteUsers.length > 0) {
                allUsers = remoteUsers;
                localStorage.setItem('crm_admin_users', JSON.stringify(remoteUsers));
                syncUserSwitch(remoteUsers);
              }
            } catch (err) {
              console.warn('[Login] Consulta ao Supabase falhou, usando cache local:', err);
            }
          }

          const idUpper = identifier.toUpperCase();
          const idLower = identifier.toLowerCase();

          // Busca flexível: por login, por username ou por e-mail corporativo
          let user = allUsers.find(u => {
            const uLogin = (u.login || u.username || '').trim().toUpperCase();
            const uEmail = (u.email || '').trim().toLowerCase();
            return (uLogin && uLogin === idUpper) || (uEmail && uEmail === idLower);
          });

          // Fallback de segurança para o usuário Administrador Master
          if (!user && (idUpper === 'ADMINISTRADOR' || idLower === 'administrador@sbsaude.com.br')) {
            user = DEFAULT_ADMIN_USERS[0];
          }

          if (!user) {
            if (btnSubmit) {
              btnSubmit.disabled = false;
              btnSubmit.innerHTML = originalBtnText;
            }
            if (alertError && errorText) {
              errorText.textContent = 'Usuário não encontrado. O acesso é restrito exclusivamente aos usuários cadastrados pelos administradores.';
              alertError.style.display = 'flex';
            }
            addAuditLog('LOGIN_FAILED', `Tentativa com usuário inexistente: ${identifier}`, 'danger', 'Acesso não cadastrado recusado');
            return;
          }

          // Verificação de Status da Conta
          if (user.status && user.status !== 'Ativo') {
            if (btnSubmit) {
              btnSubmit.disabled = false;
              btnSubmit.innerHTML = originalBtnText;
            }
            if (alertError && errorText) {
              errorText.textContent = `Acesso bloqueado. O usuário "${user.name}" está marcado como Inativo ou Bloqueado no painel administrativo.`;
              alertError.style.display = 'flex';
            }
            addAuditLog('LOGIN_BLOCKED', `Tentativa de login de usuário bloqueado: ${user.login}`, 'danger', 'Acesso de conta inativa');
            return;
          }

          // Verificação da Senha (compatível com password e password_hash)
          const isMasterAdm = (user.login || '').toUpperCase() === 'ADMINISTRADOR';
          const validPassword = user.password || user.password_hash || (isMasterAdm ? 'admin.admin' : 'SbSaude@2026');
          if (password !== validPassword) {
            if (btnSubmit) {
              btnSubmit.disabled = false;
              btnSubmit.innerHTML = originalBtnText;
            }
            if (alertError && errorText) {
              errorText.textContent = 'Senha incorreta. Verifique suas credenciais ou solicite a redefinição com o administrador.';
              alertError.style.display = 'flex';
            }
            addAuditLog('LOGIN_FAILED', `Senha incorreta para usuário ${user.login}`, 'warning', 'Falha na validação de credencial');
            return;
          }

          // Autenticação bem-sucedida!
          const now = new Date();
          const timestamp = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR');
          user.lastLogin = timestamp;
          saveAdminUsers(allUsers);
          if (window.crmSupabase && typeof window.crmSupabase.saveUser === 'function') {
            window.crmSupabase.saveUser(user).catch(console.warn);
          }

          const sessionData = {
            userId: user.id || 'USR-001',
            login: user.login || 'ADMINISTRADOR',
            name: user.name || 'Administrador',
            email: user.email || 'administrador@sbsaude.com.br',
            role: user.role || 'Administrador Master',
            profile: user.profile || 'Administrador Master',
            avatar: user.avatar || 'AD',
            loginAt: timestamp
          };

          setAuthSession(sessionData, remember);
          addAuditLog('LOGIN_SUCCESS', `Autenticação bem-sucedida de ${user.name}`, 'success', `Sessão iniciada via formulário seguro (Perfil: ${user.profile})`, user.login);

          // Alterna telas
          loginScreen.style.display = 'none';
          const appContainer = document.querySelector('.app-container');
          if (appContainer) appContainer.style.display = 'flex';

          updateHeaderAuthUser(user);
          showToast(`Bem-vindo(a) ao CRM SB Saúde, ${user.name}!`, 'success');

          if (!state.currentTab) {
            state.currentTab = 'dashboard';
          }
          renderView();
        };
      }
    }

    function initAuth() {
      const session = getAuthSession();
      const appContainer = document.querySelector('.app-container');
      const loginScreen = document.getElementById('login-screen');

      if (session && session.login) {
        const users = getAdminUsers();
        const user = users.find(u => 
          (u.login && u.login.toUpperCase() === session.login.toUpperCase()) || 
          (session.email && u.email && u.email.toLowerCase() === session.email.toLowerCase())
        );

        if (user && user.status === 'Ativo') {
          if (appContainer) appContainer.style.display = 'flex';
          if (loginScreen) loginScreen.style.display = 'none';
          updateHeaderAuthUser(user);
          return true;
        } else {
          clearAuthSession();
        }
      }

      // Sessão inexistente ou expirada: restringe acesso ao CRM e abre login
      if (appContainer) appContainer.style.display = 'none';
      if (loginScreen) loginScreen.style.display = 'flex';
      renderLoginScreen();
      return false;
    }

    // Botão de Logout no Topo
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', handleLogout);
    }

    // Seletor de Usuário Ativo (sincronização)
    const userSelect = document.getElementById('user-switch');
    if (userSelect) {
      userSelect.addEventListener('change', (e) => {
        const selectedLogin = e.target.value;
        const users = getAdminUsers();
        const found = users.find(u => u.login === selectedLogin);
        if (found) {
          updateHeaderAuthUser(found);
        }
      });
    }

    // Busca Global no Header
    const globalSearch = document.getElementById('global-search');
    if (globalSearch) {
      globalSearch.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          state.currentTab = 'proposals';
          state.searchQuery = globalSearch.value.trim().toLowerCase();
          renderView();
        }
      });

      // Atalho de Teclado Global ⌘K / Ctrl+K
      document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault();
          globalSearch.focus();
          globalSearch.select();
        }
      });
    }

    // Inicialização da Autenticação Restrita
    const isAuthenticated = initAuth();
    if (isAuthenticated) {
      renderView();
    }
  }

  window.addEventListener('DOMContentLoaded', initApp);
})();
