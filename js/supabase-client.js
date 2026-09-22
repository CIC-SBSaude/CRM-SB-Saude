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

  const DEFAULT_SUPABASE_URL = getDefaultSupabaseUrl();
  const DEFAULT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

  class SBClient {
    constructor() {
      const storedUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('CRM_SUPABASE_URL') : null;
      const defaultUrl = getDefaultSupabaseUrl();
      // Se a URL salva for 127.0.0.1 mas a página está aberta via IP da rede, atualiza dinamicamente
      if (storedUrl && (storedUrl.includes('127.0.0.1') || storedUrl.includes('localhost')) && defaultUrl !== 'http://127.0.0.1:56321') {
        this.url = defaultUrl;
        try { localStorage.setItem('CRM_SUPABASE_URL', defaultUrl); } catch (e) {}
      } else {
        this.url = storedUrl || defaultUrl;
      }
      this.anonKey = (typeof localStorage !== 'undefined' ? localStorage.getItem('CRM_SUPABASE_ANON_KEY') : null) || DEFAULT_ANON_KEY;
      this.client = null;
      this.isConnected = false;
      this.realtimeChannel = null;
      this.init();
      // Auto-reconexão periódica se estiver offline
      this.reconnectTimer = setInterval(() => {
        if (!this.isConnected && this.client) {
          this.checkConnection();
        }
      }, 12000);
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
      const badge = document.getElementById('supabase-status-badge');
      if (badge) {
        badge.remove();
      }
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

    // ==========================================
    // MÉTODOS DE LEITURA (SELECT)
    // ==========================================
    async fetchProposals() {
      if (!this.client) return null;
      try {
        const { data, error } = await this.client
          .from('proposals')
          .select('*')
          .order('id', { ascending: true });

        if (error) throw error;
        // Normalizar colunas do PostgreSQL para o formato esperado pelo CRM
        return data.map(p => ({
          _RowNumber: p.row_number,
          ID: p.id,
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
        }));
      } catch (err) {
        console.warn('[Supabase] Erro ao carregar proposals:', err);
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
          'Corretor 1': b.corretor_1,
          'Imagem': b.imagem,
          'Email': b.email,
          'Telefone': b.telefone
        }));
      } catch (err) {
        console.warn('[Supabase] Erro ao carregar brokers:', err);
        return null;
      }
    }

    async fetchCopartPolicies() {
      if (!this.client) return null;
      try {
        const { data, error } = await this.client
          .from('coparticipation_policies')
          .select('*')
          .order('id', { ascending: true });

        if (error) throw error;
        return data.map(p => ({
          _RowNumber: p.row_number || p.id,
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
        }));
      } catch (err) {
        console.warn('[Supabase] Erro ao carregar copart policies:', err);
        return null;
      }
    }

    async fetchUsers() {
      if (!this.client) return null;
      try {
        const { data, error } = await this.client
          .from('users')
          .select('*')
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
          password: u.password_hash || (u.username === 'ADMINISTRADOR' ? 'admin.admin' : 'SbSaude@2026'),
          twoFactor: u.two_factor ?? true,
          lastLogin: u.last_login || 'Primeiro acesso pendente',
          ip: u.ip || '192.168.10.1',
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
        // Parse numéricos
        const vidasNum = parseInt(String(p.VIDAS || '0').replace(/\D/g, ''), 10) || 0;
        const parseNum = v => {
          if (!v) return 0;
          let s = String(v).replace('R$', '').trim();
          s = s.replace(/\./g, '').replace(',', '.');
          return parseFloat(s) || 0;
        };
        const tkmNum = parseNum(p.TKM);
        const fatNum = parseNum(p.FATURAMENTO) || (vidasNum * tkmNum);

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

    async saveCopartPolicy(p) {
      if (!this.client) return false;
      try {
        const record = {
          id_politica: p['ID Politica'] || `CP-${Date.now()}`,
          nome_politica: (p['Politica Coparticipacao'] || '').trim(),
          percentual_desconto_evento: p['Percentual Desconto Evento'] || null,
          qnt_partida_evento: p['Qnt Partida Evento'] || null,
          valor_consulta_eletiva: p['Valor Consulta Eletiva'] || null,
          valor_consulta_emergencia: p['Valor Consulta Emergencia'] || null,
          valor_exames_simples: p['Valor Exames Simples'] || null,
          valor_exames_complexos: p['Valor Exames Complexos'] || null,
          valor_terapia: p['Valor Terapia'] || null,
          imagem: p['Imagem'] || null,
          terapia: p['Terapia'] || null,
          updated_at: new Date().toISOString()
        };

        const { error } = await this.client
          .from('coparticipation_policies')
          .upsert(record, { onConflict: 'nome_politica' });

        if (error) throw error;
        console.log(`[Supabase] Modelo de coparticipação ${p['Politica Coparticipacao']} persistido com sucesso.`);
        return true;
      } catch (err) {
        console.error('[Supabase] Erro ao salvar copart policy:', err);
        return false;
      }
    }

    async saveUser(u) {
      if (!this.client) {
        return { success: false, error: 'Cliente Supabase não inicializado ou offline.' };
      }
      try {
        const username = (u.login || u.username || '').trim();
        if (!username) {
          return { success: false, error: 'Login / Usuário obrigatório.' };
        }

        const record = {
          user_code: u.id || null,
          username: username.toUpperCase(),
          name: u.name || username,
          email: u.email || null,
          role: u.role || 'Consultor Comercial',
          profile: u.profile || 'Consultor Comercial',
          status: u.status || 'Ativo',
          password_hash: u.password || 'SbSaude@2026',
          two_factor: u.twoFactor !== false,
          last_login: u.lastLogin || null,
          ip: u.ip || null,
          avatar: u.avatar || null,
          updated_at: new Date().toISOString()
        };

        const { data, error } = await this.client
          .from('users')
          .upsert(record, { onConflict: 'username' })
          .select();

        if (error) throw error;
        console.log(`[Supabase] Usuário ${record.username} gravado com sucesso no banco.`);
        return { success: true, data };
      } catch (err) {
        console.error('[Supabase] Erro ao salvar usuário no banco:', err);
        return { success: false, error: err.message || String(err) };
      }
    }

    async syncAllUsers(users) {
      if (!this.client || !Array.isArray(users)) return false;
      try {
        const records = users.map(u => {
          const username = (u.login || u.username || '').trim().toUpperCase();
          return {
            user_code: u.id || null,
            username,
            name: u.name || username,
            email: u.email || `${username.toLowerCase()}@sbsaude.com.br`,
            role: u.role || 'Consultor Comercial',
            profile: u.profile || (username === 'ADMINISTRADOR' ? 'Administrador Master' : (u.role || 'Consultor Comercial')),
            status: u.status || 'Ativo',
            password_hash: u.password || (username === 'ADMINISTRADOR' ? 'admin.admin' : 'SbSaude@2026'),
            two_factor: u.twoFactor !== false,
            last_login: u.lastLogin || null,
            ip: u.ip || null,
            avatar: u.avatar || null,
            updated_at: new Date().toISOString()
          };
        }).filter(r => Boolean(r.username));

        if (records.length === 0) return true;

        const { error } = await this.client
          .from('users')
          .upsert(records, { onConflict: 'username' });

        if (error) throw error;
        console.log(`[Supabase] ${records.length} usuário(s) sincronizados em lote com sucesso.`);
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
        const { error } = await this.client
          .from('users')
          .delete()
          .ilike('username', clean);

        if (error) throw error;
        console.log(`[Supabase] Usuário ${clean} removido do banco.`);
        return true;
      } catch (err) {
        console.error('[Supabase] Erro ao excluir usuário no banco:', err);
        return false;
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
                callbacks.onProposalChange(payload);
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
          .subscribe(status => {
            console.log('[Supabase Realtime] Status da inscrição:', status);
          });
      } catch (err) {
        console.warn('[Supabase] Falha ao configurar canal Realtime:', err);
      }
    }
  }

  // Exportar instância global
  window.crmSupabase = new SBClient();
})();
