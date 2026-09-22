/**
 * CRM SB Saúde - Supabase Client & Realtime Integration
 * Conecta o frontend ao Supabase CLI rodando localmente via Docker (127.0.0.1:56321 / 56322)
 */

(function () {
  'use strict';

  // Resolução dinâmica da URL do Supabase para suportar tanto localhost quanto IP de rede (ex: 192.168.91.103)
  function getDefaultSupabaseUrl() {
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
      const h = window.location.hostname;
      if (h && h !== 'localhost' && h !== '127.0.0.1') {
        return `http://${h}:56321`;
      }
    }
    return 'http://127.0.0.1:56321';
  }

  function getEffectiveSupabaseUrl() {
    const defaultUrl = getDefaultSupabaseUrl();
    const storedUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('CRM_SUPABASE_URL') : null;
    if (!storedUrl) return defaultUrl;

    let currentHost = '127.0.0.1';
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
      currentHost = window.location.hostname;
    }

    try {
      const parsed = new URL(storedUrl);
      const isLoopbackStored = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      const isLoopbackCurrent = currentHost === 'localhost' || currentHost === '127.0.0.1';
      if ((isLoopbackStored && isLoopbackCurrent) || parsed.hostname === currentHost) {
        return storedUrl;
      }
      // Se storedUrl apontar para outro host/IP obsoleto de outra rede, descarta e sincroniza com a origem
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem('CRM_SUPABASE_URL', defaultUrl); } catch (e) {}
      }
      return defaultUrl;
    } catch (e) {
      return defaultUrl;
    }
  }

  const DEFAULT_SUPABASE_URL = getDefaultSupabaseUrl();
  const DEFAULT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

  class SBClient {
    constructor() {
      this.url = getEffectiveSupabaseUrl();
      this.anonKey = (typeof localStorage !== 'undefined' ? localStorage.getItem('CRM_SUPABASE_ANON_KEY') : null) || DEFAULT_ANON_KEY;
      this.client = null;
      this.isConnected = false;
      this.realtimeChannel = null;
      this.syncState = 'idle'; // 'idle' | 'loading' | 'complete' | 'error' | 'offline'
      this.lastSyncError = null;
      this.lastSyncTime = null;
      this.init();
      // Auto-reconexão periódica se estiver offline
      this.reconnectTimer = setInterval(() => {
        if (!this.isConnected && this.client) {
          this.checkConnection();
        }
      }, 12000);
      if (this.reconnectTimer && typeof this.reconnectTimer.unref === 'function') {
        this.reconnectTimer.unref();
      }
    }

    getSyncStatus() {
      return {
        isConnected: this.isConnected,
        state: this.syncState,
        error: this.lastSyncError,
        lastSyncTime: this.lastSyncTime
      };
    }

    init() {
      try {
        const createClientFn = window.supabase?.createClient || (typeof supabase !== 'undefined' ? supabase.createClient : null);
        if (typeof createClientFn === 'function') {
          this.client = createClientFn(this.url, this.anonKey, {
            realtime: {
              params: {
                eventsPerSecond: 10
              }
            }
          });
          this.checkConnection();
        } else {
          console.warn('[Supabase] SDK @supabase/supabase-js não encontrado no escopo global.');
        }
      } catch (err) {
        console.error('[Supabase] Erro ao inicializar client:', err);
      }
    }

    async checkConnection() {
      if (!this.client) return false;
      try {
        const { count, error } = await this.client
          .from('companies')
          .select('*', { count: 'exact', head: true });

        if (error) {
          console.warn('[Supabase] Falha ao testar conexão:', error.message);
          this.isConnected = false;
          this.updateConnectionIndicator(false);
          return false;
        }

        const wasDisconnected = !this.isConnected;
        this.isConnected = true;
        this.updateConnectionIndicator(true);
        console.log(`[Supabase] Conectado com sucesso a ${this.url}! Registros verificados.`);
        if (wasDisconnected) {
          window.dispatchEvent(new CustomEvent('supabase:connected'));
        }
        return true;
      } catch (e) {
        this.isConnected = false;
        this.updateConnectionIndicator(false);
        return false;
      }
    }

    updateConnectionIndicator(connected) {
      if (typeof document === 'undefined') return;
      const badge = document.getElementById('supabase-status-badge');
      if (badge) {
        badge.remove();
      }
    }

    async signOut() {
      if (this.client && this.client.auth && typeof this.client.auth.signOut === 'function') {
        try {
          await this.client.auth.signOut();
          console.log('[Supabase] Sessão remota encerrada via API de autenticação.');
        } catch (e) {
          console.warn('[Supabase] Aviso ao encerrar sessão remota:', e?.message || e);
        }
      }
      return true;
    }

    async syncAllUsers(users) {
      if (!this.client) return { success: false, synced: 0, error: 'Cliente Supabase não inicializado' };
      if (!this.isConnected) {
        const ok = await this.checkConnection();
        if (!ok) return { success: false, synced: 0, error: 'Supabase indisponível no momento' };
      }
      try {
        let count = 0;
        for (const u of users) {
          const res = await this.saveUser(u);
          if (res && (res === true || res.success)) count++;
        }
        return { success: true, synced: count };
      } catch (err) {
        console.error('[Supabase] Erro ao sincronizar lote de usuários:', err);
        return { success: false, synced: 0, error: err.message };
      }
    }

    mapDbProposalToCrm(p) {
      if (!p) return null;
      return {
        _RowNumber: p.row_number,
        ID: String(p.id),
        DATA_DA_PROSPECCAO: p.data_da_prospeccao,
        EMPRESA: p.empresa,
        CNPJ: p.cnpj,
        COMPETENCIA: p.competencia,
        VIDAS: p.vidas,
        CIDADE: p.cidade,
        UF: p.uf,
        TKM: p.tkm,
        FATURAMENTO: p.faturamento,
        ACOMODACAO: p.acomodacao,
        FATOR_MODERADOR: p.fator_moderador,
        POLITICA_COPARTICIPACAO: p.politica_coparticipacao,
        CORRETORES_1: p.corretores_1,
        CORRETORES_2: p.corretores_2,
        CORRETORES_3: p.corretores_3,
        AGENCIAMENTO_1: p.agenciamento_1,
        AGENCIAMENTO_2: p.agenciamento_2,
        AGENCIAMENTO_3: p.agenciamento_3,
        VITALICIO_1: p.vitalicio_1,
        VITALICIO_2: p.vitalicio_2,
        VITALICIO_3: p.vitalicio_3,
        PLANO_CAMPANHA: p.plano_campanha,
        Status_Campanha: p.status_campanha,
        TEMPERATURA_CONTRATO: p.temperatura_contrato,
        Usuario: p.usuario,
        Data_Inclusao: p.data_inclusao,
        Hora_Inclusao: p.hora_inclusao,
        Aptidao: p.aptidao,
        Tipo_Contrato: p.tipo_contrato,
        Qnt_Faixa_Etaria: p.qnt_faixa_etaria,
        Faixa_Etaria: p.faixa_etaria,
        Data_Analise_tecnica: p.data_analise_tecnica,
        Data_Avaliacao_Diretoria: p.data_avaliacao_diretoria,
        Data_Envio_Corretor: p.data_envio_corretor,
        Motivo_Declinio: p.motivo_declinio,
        Observacao: p.observacao,
        Conversao_Solus: p.conversao_solus,
        Status_Contrato: p.status_contrato,
        Plataforma: p.plataforma
      };
    }

    // ==========================================
    // MÉTODOS DE LEITURA (SELECT)
    // ==========================================
    async fetchProposals(options = {}) {
      if (!this.client) {
        this.syncState = 'offline';
        return null;
      }
      this.syncState = 'loading';
      this.lastSyncError = null;

      const pageSize = options.pageSize || 500;
      const maxRetries = options.maxRetries || 3;

      try {
        // 1. Obter a primeira página com contagem exata
        let firstResult = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          const res = await this.client
            .from('proposals')
            .select('*', { count: 'exact' })
            .order('id', { ascending: true })
            .range(0, pageSize - 1);
          if (!res.error) {
            firstResult = res;
            break;
          }
          console.warn(`[Supabase] Tentativa ${attempt} falhou ao consultar página 1:`, res.error.message);
          if (attempt === maxRetries) throw res.error;
          await new Promise(r => setTimeout(r, 300 * attempt));
        }

        const { data: firstPage, count: totalCount } = firstResult;
        if (typeof totalCount !== 'number') {
          throw new Error('Supabase Data API não retornou a contagem total exata (count)');
        }

        if (totalCount === 0) {
          this.syncState = 'complete';
          this.lastSyncTime = new Date().toISOString();
          return [];
        }

        const allRows = [...(firstPage || [])];

        // 2. Paginação estável e determinística para as páginas subsequentes
        for (let offset = pageSize; offset < totalCount; offset += pageSize) {
          const to = Math.min(offset + pageSize - 1, totalCount - 1);
          let pageSuccess = false;
          let lastPageError = null;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const { data: pageData, error: pageError } = await this.client
              .from('proposals')
              .select('*')
              .order('id', { ascending: true })
              .range(offset, to);

            if (!pageError && Array.isArray(pageData)) {
              allRows.push(...pageData);
              pageSuccess = true;
              break;
            }
            lastPageError = pageError;
            console.warn(`[Supabase] Tentativa ${attempt} falhou ao buscar página offset ${offset}:`, pageError?.message);
            await new Promise(r => setTimeout(r, 300 * attempt));
          }

          if (!pageSuccess) {
            throw new Error(`Falha irrecuperável na página de propostas (offset ${offset} a ${to}): ${lastPageError?.message || 'timeout'}`);
          }
        }

        // 3. Verificação estrita de completude e unicidade de ID
        if (allRows.length !== totalCount) {
          throw new Error(`Inconsistência de completude na sincronização: esperado ${totalCount} registros, mas recebidos ${allRows.length}. A sincronização foi abortada para evitar truncamento.`);
        }

        const seenIds = new Set();
        for (const r of allRows) {
          const idStr = String(r.id);
          if (seenIds.has(idStr)) {
            throw new Error(`ID duplicado retornado pela API na paginação: ${idStr}`);
          }
          seenIds.add(idStr);
        }

        this.syncState = 'complete';
        this.lastSyncTime = new Date().toISOString();

        // 4. Normalizar colunas do PostgreSQL para o formato esperado pelo CRM
        return allRows.map(p => this.mapDbProposalToCrm(p));
      } catch (err) {
        this.syncState = 'error';
        this.lastSyncError = err.message;
        console.warn('[Supabase] Erro ao carregar proposals paginadas:', err.message);
        return null;
      }
    }

    async fetchCompanies() {
      if (!this.client) return null;
      try {
        const { data, error } = await this.client
          .from('companies')
          .select('*')
          .order('id', { ascending: true });

        if (error) throw error;
        return data.map(c => ({
          _RowNumber: c.row_number || c.id,
          EMPRESA: c.empresa,
          CNPJ: c.cnpj,
          UF: c.uf,
          LOGO: c.logo || '',
          PLANO_CAMPANHA: c.plano_campanha || '',
          CORRETORES_1: c.corretores_1 || '',
          CORRETORES_2: c.corretores_2 || '',
          CORRETORES_3: c.corretores_3 || ''
        }));
      } catch (err) {
        console.warn('[Supabase] Erro ao carregar companies:', err);
        return null;
      }
    }

    async fetchBrokers() {
      if (!this.client) return null;
      try {
        const { data, error } = await this.client
          .from('brokers')
          .select('*')
          .order('id', { ascending: true });

        if (error) throw error;
        return data.map(b => ({
          _RowNumber: b.row_number || b.id,
          CORRETOR_1: b.corretor_1 || '',
          'Corretor 1': b.corretor_1 || '',
          corretor_1: b.corretor_1 || '',
          'Imagem': b.imagem || '',
          Imagem: b.imagem || '',
          imagem: b.imagem || '',
          'Email': b.email || '',
          Email: b.email || '',
          'Telefone': b.telefone || '',
          Telefone: b.telefone || ''
        }));
      } catch (err) {
        console.warn('[Supabase] Erro ao carregar brokers:', err);
        return null;
      }
    }

    mapDbToCopartPolicy(p) {
      if (!p) return null;
      const desc = p.percentual_desconto_evento || '0,00%';
      const eletiva = p.valor_consulta_eletiva || 'R$ 0,00';
      const emergencia = p.valor_consulta_emergencia || 'R$ 0,00';
      const simples = p.valor_exames_simples || 'R$ 0,00';
      const complexos = p.valor_exames_complexos || 'R$ 0,00';
      const ultrapasse = p.qnt_partida_evento !== null && p.qnt_partida_evento !== undefined ? String(p.qnt_partida_evento) : '0';
      const terapia = p.terapia === 'Sim' ? 'Sim' : 'Não';
      const valorTerapia = p.valor_terapia || (terapia === 'Sim' ? 'R$ 0,00' : 'Não aplicável');
      const nome = p.nome_politica || '';
      const idPolitica = p.id_politica || (p.id ? `CP-${p.id}` : `CP-${Date.now()}`);
      const rowNumber = p.row_number || (p.id ? String(p.id + 1) : null);
      const imagem = p.imagem || '';

      return {
        id: p.id || null,
        _RowNumber: rowNumber,
        Id_Politica: idPolitica,
        Nome_Politica: nome,
        Percentual_Desconto_Evento: desc,
        Desconto_Evento: desc,
        Qnt_Partida_Evento: ultrapasse,
        Valor_Consulta_Eletiva: eletiva,
        Consulta_Eletiva: eletiva,
        Valor_Consulta_Emergencia: emergencia,
        Emergencia: emergencia,
        Valor_Exames_Simples: simples,
        Exames_Simples: simples,
        Valor_Exames_Complexos: complexos,
        Exames_Complexos: complexos,
        Terapia: terapia,
        Valor_Terapia: valorTerapia,
        Imagem: imagem
      };
    }

    mapCopartPolicyToDb(p) {
      if (!p) return null;
      const nome = (p.Nome_Politica || p['Politica Coparticipacao'] || p.nome_politica || '').trim();
      const idPolitica = p.Id_Politica || p['ID Politica'] || p.id_politica || `CP-${Date.now()}`;
      const desc = p.Percentual_Desconto_Evento || p.Desconto_Evento || p['Percentual Desconto Evento'] || p.percentual_desconto_evento || '0,00%';
      const ultrapasse = p.Qnt_Partida_Evento !== undefined ? String(p.Qnt_Partida_Evento) : (p['Qnt Partida Evento'] !== undefined ? String(p['Qnt Partida Evento']) : (p.qnt_partida_evento !== undefined ? String(p.qnt_partida_evento) : '0'));
      const eletiva = p.Valor_Consulta_Eletiva || p.Consulta_Eletiva || p['Valor Consulta Eletiva'] || p.valor_consulta_eletiva || 'R$ 0,00';
      const emergencia = p.Valor_Consulta_Emergencia || p.Emergencia || p['Valor Consulta Emergencia'] || p.valor_consulta_emergencia || 'R$ 0,00';
      const simples = p.Valor_Exames_Simples || p.Exames_Simples || p['Valor Exames Simples'] || p.valor_exames_simples || 'R$ 0,00';
      const complexos = p.Valor_Exames_Complexos || p.Exames_Complexos || p['Valor Exames Complexos'] || p.valor_exames_complexos || 'R$ 0,00';
      const terapia = (p.Terapia || p['Terapia'] || p.terapia || 'Não') === 'Sim' ? 'Sim' : 'Não';
      const valorTerapia = terapia === 'Sim' ? (p.Valor_Terapia || p['Valor Terapia'] || p.valor_terapia || 'R$ 0,00') : 'Não aplicável';
      const imagem = p.Imagem !== undefined ? p.Imagem : (p['Imagem'] !== undefined ? p['Imagem'] : (p.imagem || ''));

      const dbRecord = {
        id_politica: idPolitica,
        nome_politica: nome,
        percentual_desconto_evento: desc,
        qnt_partida_evento: ultrapasse,
        valor_consulta_eletiva: eletiva,
        valor_consulta_emergencia: emergencia,
        valor_exames_simples: simples,
        valor_exames_complexos: complexos,
        valor_terapia: valorTerapia,
        imagem: imagem || null,
        terapia: terapia,
        updated_at: new Date().toISOString()
      };

      if (p.id) {
        dbRecord.id = p.id;
      }
      if (p._RowNumber) {
        const parsed = parseInt(p._RowNumber, 10);
        if (!isNaN(parsed)) dbRecord.row_number = parsed;
      }
      return dbRecord;
    }

    async fetchCopartPolicies() {
      if (!this.client) return null;
      try {
        const { data, error } = await this.client
          .from('coparticipation_policies')
          .select('*')
          .order('id', { ascending: true });

        if (error) throw error;
        return (data || []).map(p => this.mapDbToCopartPolicy(p));
      } catch (err) {
        console.warn('[Supabase] Erro ao carregar copart policies:', err);
        return null;
      }
    }

    getSessionToken() {
      if (this.sessionToken) return this.sessionToken;
      try {
        const fromSession = sessionStorage.getItem('crm_session_token');
        if (fromSession) {
          this.sessionToken = fromSession;
          return fromSession;
        }
        const sessionData = localStorage.getItem('crm_auth_session');
        if (sessionData) {
          const parsed = JSON.parse(sessionData);
          if (parsed && parsed.sessionToken) {
            this.sessionToken = parsed.sessionToken;
            return parsed.sessionToken;
          }
        }
      } catch (e) {}
      return null;
    }

    async login(identifier, password) {
      if (!this.client) {
        return { success: false, error_code: 'CLIENT_OFFLINE', message: 'Cliente Supabase não inicializado ou offline.' };
      }
      if (!identifier || typeof password !== 'string' || password.length === 0) {
        return { success: false, error_code: 'INVALID_CREDENTIALS', message: 'Por favor, informe seu usuário ou e-mail e a senha de acesso.' };
      }

      // Preserva a senha exatamente como digitada (sem trim) e normaliza identificador
      const cleanUser = String(identifier).trim();
      const rawPassword = String(password);

      try {
        const { data, error } = await this.client.rpc('auth_login', {
          p_user: cleanUser,
          p_password: rawPassword
        });
        if (error) {
          console.warn('[Supabase] Erro ao invocar auth_login RPC:', error.message);
          return { success: false, error_code: 'RPC_ERROR', message: error.message };
        }
        if (data && data.success && data.session_token) {
          this.sessionToken = data.session_token;
          try {
            sessionStorage.setItem('crm_session_token', data.session_token);
          } catch (e) {}
        }
        return data || { success: false, error_code: 'EMPTY_RESPONSE', message: 'Resposta vazia do servidor.' };
      } catch (err) {
        console.warn('[Supabase] Exceção ao invocar login RPC:', err);
        return { success: false, error_code: 'NETWORK_ERROR', message: err?.message || String(err) };
      }
    }

    async resetPassword(targetUsername, newPassword) {
      if (!this.client) {
        return { success: false, error_code: 'CLIENT_OFFLINE', error: 'Cliente Supabase não inicializado ou offline.' };
      }
      const token = this.getSessionToken();
      if (!token) {
        return { success: false, error_code: 'UNAUTHORIZED', error: 'Sessão administrativa não autenticada no servidor.' };
      }
      const cleanTarget = String(targetUsername || '').trim();
      const rawPassword = String(newPassword || '');

      if (!cleanTarget) {
        return { success: false, error_code: 'INVALID_DATA', error: 'Usuário alvo não especificado.' };
      }
      if (rawPassword.length < 6) {
        return { success: false, error_code: 'WEAK_PASSWORD', error: 'A nova senha deve possuir no mínimo 6 caracteres.' };
      }

      try {
        const { data, error } = await this.client.rpc('admin_reset_password', {
          p_session_token: token,
          p_target_username: cleanTarget,
          p_new_password: rawPassword
        });
        if (error) {
          console.warn('[Supabase] Erro ao invocar admin_reset_password:', error.message);
          return { success: false, error_code: 'RPC_ERROR', error: error.message };
        }
        if (!data || data.success === false) {
          return { success: false, error_code: data?.error_code || 'RESET_FAILED', error: data?.message || 'Falha ao redefinir senha no servidor.' };
        }

        // Leitura de verificação autorizada: confirmar que o registro foi atualizado no banco
        try {
          const { data: verifyUser, error: verifyErr } = await this.client
            .from('users')
            .select('username, updated_at, status')
            .ilike('username', cleanTarget)
            .limit(1)
            .maybeSingle();

          if (!verifyErr && verifyUser) {
            data.verified_user = verifyUser;
          }
        } catch (ve) {
          console.warn('[Supabase] Aviso ao verificar atualização de usuário:', ve);
        }

        return data;
      } catch (err) {
        console.error('[Supabase] Exceção ao redefinir senha:', err);
        return { success: false, error_code: 'NETWORK_ERROR', error: err?.message || String(err) };
      }
    }

    async fetchUsers() {
      if (!this.client) return null;
      try {
        const { data, error } = await this.client
          .from('users')
          .select('id, row_number, user_code, username, name, email, role, profile, status, two_factor, last_login, ip, avatar, created_at, updated_at')
          .order('id', { ascending: true });

        if (error) throw error;
        return data.map(u => ({
          id: u.user_code || ('USR-' + String(u.id).padStart(3, '0')),
          login: u.username,
          name: u.name || u.username,
          email: u.email || `${u.username.toLowerCase()}@sbsaude.com.br`,
          role: u.role || 'Consultor Comercial',
          profile: u.profile || (u.username === 'ADMINISTRADOR' ? 'Administrador Master' : (u.role || 'Consultor Comercial')),
          status: u.status || 'Ativo',
          twoFactor: u.two_factor ?? true,
          lastLogin: u.last_login || 'Primeiro acesso pendente',
          ip: u.ip || null,
          avatar: u.avatar || (u.name ? u.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() : u.username.slice(0, 2)),
          createdAt: u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '21/09/2026'
        }));
      } catch (err) {
        console.warn('[Supabase] Erro ao carregar users:', err);
        return null;
      }
    }

    // ==========================================
    // MÉTODOS DE ESCRITA (INSERT / UPDATE / DELETE)
    // ==========================================
    async saveProposal(p) {
      if (!this.client) return false;
      try {
        // Parse numéricos utilizando BusinessRules padronizado
        const vidasNum = typeof BusinessRules !== 'undefined' ? BusinessRules.parseLives(p.VIDAS) : (parseInt(String(p.VIDAS || '0').replace(/\D/g, ''), 10) || 0);
        const parseNum = v => {
          if (!v) return 0;
          let s = String(v).replace('R$', '').trim();
          s = s.replace(/\./g, '').replace(',', '.');
          return parseFloat(s) || 0;
        };
        const tkmNum = typeof BusinessRules !== 'undefined' ? BusinessRules.parseCurrency(p.TKM) : parseNum(p.TKM);
        const fatNum = (typeof BusinessRules !== 'undefined' ? BusinessRules.parseCurrency(p.FATURAMENTO) : parseNum(p.FATURAMENTO)) || (vidasNum * tkmNum);

        const record = {
          id: String(p.ID),
          row_number: parseInt(p._RowNumber, 10) || null,
          codigo_proposta: p.CODIGO_PROPOSTA || `PRP-${p.ID}`,
          data_da_prospeccao: p.DATA_DA_PROSPECCAO || null,
          empresa: (p.EMPRESA || 'Empresa').trim(),
          cnpj: p.CNPJ || null,
          competencia: p.COMPETENCIA || null,
          vidas: String(p.VIDAS || '0'),
          vidas_num: vidasNum,
          cidade: p.CIDADE || null,
          uf: p.UF || null,
          tkm: p.TKM || 'R$ 0,00',
          tkm_num: tkmNum,
          faturamento: p.FATURAMENTO || 'R$ 0,00',
          faturamento_num: fatNum,
          acomodacao: p.ACOMODACAO || null,
          fator_moderador: p.FATOR_MODERADOR || null,
          politica_coparticipacao: p.POLITICA_COPARTICIPACAO || null,
          corretores_1: p.CORRETORES_1 || null,
          agenciamento_1: p.AGENCIAMENTO_1 || null,
          vitalicio_1: p.VITALICIO_1 || null,
          corretores_2: p.CORRETORES_2 || null,
          agenciamento_2: p.AGENCIAMENTO_2 || null,
          vitalicio_2: p.VITALICIO_2 || null,
          corretores_3: p.CORRETORES_3 || null,
          agenciamento_3: p.AGENCIAMENTO_3 || null,
          vitalicio_3: p.VITALICIO_3 || null,
          plano_campanha: p.PLANO_CAMPANHA || null,
          status_campanha: p.Status_Campanha || 'Fora da Campanha',
          temperatura_contrato: p.TEMPERATURA_CONTRATO || 'Iniciada',
          aptidao: p.Aptidao || 'Apto',
          usuario: p.Usuario || null,
          data_inclusao: p.Data_Inclusao || null,
          hora_inclusao: p.Hora_Inclusao || null,
          tipo_contrato: p.Tipo_Contrato || null,
          qnt_faixa_etaria: p.Qnt_Faixa_Etaria || null,
          faixa_etaria: p.Faixa_Etaria || null,
          data_analise_tecnica: p.Data_Analise_tecnica || null,
          data_avaliacao_diretoria: p.Data_Avaliacao_Diretoria || null,
          data_envio_corretor: p.Data_Envio_Corretor || null,
          motivo_declinio: p.Motivo_Declinio || null,
          observacao: p.Observacao || null,
          conversao_solus: p.Conversao_Solus || null,
          status_contrato: p.Status_Contrato || null,
          plataforma: p.Plataforma || null,
          updated_at: new Date().toISOString()
        };

        const { error } = await this.client
          .from('proposals')
          .upsert(record, { onConflict: 'id' });

        if (error) throw error;
        console.log(`[Supabase] Proposta ${p.ID} persistida com sucesso.`);
        return true;
      } catch (err) {
        console.error('[Supabase] Erro ao salvar proposta:', err);
        return false;
      }
    }

    async deleteProposal(id) {
      if (!this.client) return false;
      try {
        const { error } = await this.client
          .from('proposals')
          .delete()
          .eq('id', String(id));

        if (error) throw error;
        console.log(`[Supabase] Proposta ${id} excluída com sucesso.`);
        return true;
      } catch (err) {
        console.error('[Supabase] Erro ao excluir proposta:', err);
        return false;
      }
    }

    async saveCompany(c) {
      if (!this.client) return false;
      try {
        const record = {
          empresa: (c.EMPRESA || '').trim(),
          cnpj: c.CNPJ || null,
          uf: c.UF || null,
          logo: c.LOGO || null,
          plano_campanha: c.PLANO_CAMPANHA || null,
          corretores_1: c.CORRETORES_1 || null,
          corretores_2: c.CORRETORES_2 || null,
          corretores_3: c.CORRETORES_3 || null,
          updated_at: new Date().toISOString()
        };

        const { error } = await this.client
          .from('companies')
          .upsert(record, { onConflict: 'empresa' });

        if (error) throw error;
        console.log(`[Supabase] Empresa ${c.EMPRESA} persistida com sucesso.`);
        return true;
      } catch (err) {
        console.error('[Supabase] Erro ao salvar empresa:', err);
        return false;
      }
    }

    async saveBroker(b) {
      if (!this.client) return false;
      try {
        const name = (b.CORRETOR_1 || b['Corretor 1'] || b.corretor_1 || '').trim();
        if (!name) return false;
        const record = {
          corretor_1: name,
          imagem: b.Imagem || b.imagem || null,
          email: b.Email || b.email || null,
          telefone: b.Telefone || b.telefone || null,
          updated_at: new Date().toISOString()
        };
        const { error } = await this.client
          .from('brokers')
          .upsert(record, { onConflict: 'corretor_1' });

        if (error) throw error;
        console.log(`[Supabase] Corretor ${name} persistido com sucesso.`);
        return true;
      } catch (err) {
        console.error('[Supabase] Erro ao salvar corretor:', err);
        return false;
      }
    }

    async saveCopartPolicy(p) {
      if (!this.client) {
        return { success: false, error: 'Cliente Supabase não inicializado ou offline.' };
      }
      try {
        const record = this.mapCopartPolicyToDb(p);
        if (!record || !record.nome_politica) {
          return { success: false, error: 'O Nome da Política de Coparticipação é obrigatório.' };
        }

        let resultData = null;
        if (p.id) {
          // Edição de registro existente pelo ID primário estável
          const updatePayload = {
            id_politica: record.id_politica,
            nome_politica: record.nome_politica,
            percentual_desconto_evento: record.percentual_desconto_evento,
            qnt_partida_evento: record.qnt_partida_evento,
            valor_consulta_eletiva: record.valor_consulta_eletiva,
            valor_consulta_emergencia: record.valor_consulta_emergencia,
            valor_exames_simples: record.valor_exames_simples,
            valor_exames_complexos: record.valor_exames_complexos,
            valor_terapia: record.valor_terapia,
            imagem: record.imagem,
            terapia: record.terapia,
            updated_at: record.updated_at
          };

          const { data, error } = await this.client
            .from('coparticipation_policies')
            .update(updatePayload)
            .eq('id', p.id)
            .select()
            .single();

          if (error) {
            if (error.code === '23505') {
              return { success: false, error: `Já existe outro modelo de coparticipação cadastrado com o nome "${record.nome_politica}".` };
            }
            throw error;
          }
          resultData = data;
        } else {
          // Criação de novo modelo
          const insertPayload = { ...record };
          delete insertPayload.id;

          const { data, error } = await this.client
            .from('coparticipation_policies')
            .insert(insertPayload)
            .select()
            .single();

          if (error) {
            if (error.code === '23505') {
              return { success: false, error: `Já existe um modelo de coparticipação cadastrado com o nome "${record.nome_politica}".` };
            }
            throw error;
          }
          resultData = data;
        }

        const canonical = this.mapDbToCopartPolicy(resultData);
        console.log(`[Supabase] Modelo de coparticipação "${canonical.Nome_Politica}" salvo com sucesso (ID: ${canonical.id}).`);
        return { success: true, data: canonical };
      } catch (err) {
        console.error('[Supabase] Erro ao salvar copart policy:', err);
        return { success: false, error: err?.message || String(err) };
      }
    }

    async deleteCopartPolicy(idOrName) {
      if (!this.client) {
        return { success: false, error: 'Cliente Supabase não inicializado ou offline.' };
      }
      try {
        let query = this.client.from('coparticipation_policies').delete();
        if (typeof idOrName === 'number' || (!isNaN(Number(idOrName)) && Number(idOrName) > 0)) {
          query = query.eq('id', Number(idOrName));
        } else {
          query = query.eq('nome_politica', String(idOrName));
        }

        const { error } = await query;
        if (error) throw error;
        console.log(`[Supabase] Modelo de coparticipação ${idOrName} excluído do banco com sucesso.`);
        return { success: true };
      } catch (err) {
        console.error('[Supabase] Erro ao excluir modelo de coparticipação:', err);
        return { success: false, error: err?.message || String(err) };
      }
    }

    async saveUser(u) {
      if (!this.client) {
        return { success: false, error: 'Cliente Supabase não inicializado ou offline.' };
      }
      try {
        const username = (u.login || u.username || '').trim().toUpperCase();
        if (!username) {
          return { success: false, error: 'Login / Usuário obrigatório.' };
        }

        const token = this.getSessionToken();
        const { data, error } = await this.client.rpc('admin_save_user', {
          p_session_token: token,
          p_user_data: {
            user_code: u.id || null,
            username: username,
            name: u.name || username,
            email: u.email || null,
            role: u.role || 'Consultor Comercial',
            profile: u.profile || (username === 'ADMINISTRADOR' ? 'Administrador Master' : (u.role || 'Consultor Comercial')),
            status: u.status || 'Ativo',
            two_factor: u.twoFactor !== false,
            avatar: u.avatar || null,
            password: u.password || null
          }
        });

        if (error) throw error;
        if (data && data.success === false) {
          throw new Error(data.message || 'Falha ao salvar usuário no servidor.');
        }
        console.log(`[Supabase] Perfil do usuário ${username} salvo via RPC com sucesso.`);
        return { success: true, data };
      } catch (err) {
        console.error('[Supabase] Erro ao salvar usuário no banco:', err);
        return { success: false, error: err.message || String(err) };
      }
    }

    async syncAllUsers(users) {
      if (!this.client || !Array.isArray(users)) return false;
      try {
        for (const u of users) {
          await this.saveUser(u);
        }
        console.log(`[Supabase] ${users.length} usuário(s) sincronizados com sucesso.`);
        return true;
      } catch (err) {
        console.error('[Supabase] Erro ao sincronizar lote de usuários:', err);
        return false;
      }
    }

    async deleteUser(loginOrId) {
      if (!this.client) return false;
      try {
        const clean = String(loginOrId).trim().toUpperCase();
        const token = this.getSessionToken();
        const { data, error } = await this.client.rpc('admin_delete_user', {
          p_session_token: token,
          p_target_username: clean
        });

        if (error) throw error;
        if (data && data.success === false) {
          throw new Error(data.message || 'Falha ao excluir usuário.');
        }
        console.log(`[Supabase] Usuário ${clean} removido do banco via RPC.`);
        return true;
      } catch (err) {
        console.error('[Supabase] Erro ao excluir usuário no banco:', err);
        return false;
      }
    }

    async signOut() {
      const token = this.getSessionToken();
      if (token && this.client) {
        try {
          await this.client.rpc('auth_logout', { p_session_token: token });
        } catch (e) {}
      }
      this.sessionToken = null;
      try {
        sessionStorage.removeItem('crm_session_token');
      } catch (e) {}
      if (this.client && this.client.auth && typeof this.client.auth.signOut === 'function') {
        try {
          await this.client.auth.signOut();
        } catch (e) {}
      }
    }

    // ==========================================
    // REALTIME SUBSCRIPTIONS
    // ==========================================
    setupRealtime(callbacks = {}) {
      if (!this.client) return;
      try {
        if (this.realtimeChannel) {
          this.realtimeChannel.unsubscribe();
        }

        this.realtimeChannel = this.client
          .channel('crm_db_changes')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'proposals' },
            payload => {
              console.log('[Supabase Realtime] Evento na tabela proposals:', payload.eventType, payload.new?.id || payload.old?.id);
              if (typeof callbacks.onProposalChange === 'function') {
                const mappedNew = payload.new ? this.mapDbProposalToCrm(payload.new) : null;
                const mappedOld = payload.old ? { id: String(payload.old.id), ID: String(payload.old.id) } : null;
                callbacks.onProposalChange({ ...payload, newProposal: mappedNew, oldProposal: mappedOld });
              }
            }
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'companies' },
            payload => {
              console.log('[Supabase Realtime] Evento na tabela companies:', payload.eventType, payload.new?.empresa);
              if (typeof callbacks.onCompanyChange === 'function') {
                callbacks.onCompanyChange(payload);
              }
            }
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'coparticipation_policies' },
            payload => {
              console.log('[Supabase Realtime] Evento na tabela coparticipation_policies:', payload.eventType, payload.new?.nome_politica);
              if (typeof callbacks.onCopartChange === 'function') {
                callbacks.onCopartChange(payload);
              }
            }
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'users' },
            payload => {
              console.log('[Supabase Realtime] Evento na tabela users:', payload.eventType, payload.new?.username || payload.old?.username);
              if (typeof callbacks.onUserChange === 'function') {
                callbacks.onUserChange(payload);
              }
            }
          )
          .subscribe((status, err) => {
            console.log('[Supabase Realtime] Status da inscrição:', status, err || '');
            this.realtimeStatus = status;
            if (typeof callbacks.onStatusChange === 'function') {
              callbacks.onStatusChange(status, err);
            }
          });
      } catch (err) {
        console.warn('[Supabase] Falha ao configurar canal Realtime:', err);
      }
    }
  }

  // Exportar instância global e classe para browser e Node.js
  if (typeof window !== 'undefined') {
    window.crmSupabase = new SBClient();
    window.CRMSupabaseClient = SBClient;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SBClient };
  }
})();
