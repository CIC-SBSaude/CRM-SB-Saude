-- ==============================================================================
-- SCHEMA DDL: CRM SB SAÚDE (SUPABASE / POSTGRESQL 17)
-- ==============================================================================

-- 1. EXTENSÕES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. FUNÇÃO PADRÃO DE ATUALIZAÇÃO DE TIMESTAMPS
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. TABELA: ESTADOS (UFs)
CREATE TABLE IF NOT EXISTS public.ufs (
  uf VARCHAR(2) PRIMARY KEY,
  nome TEXT NOT NULL,
  regiao TEXT
);

-- 4. TABELA: EMPRESAS (COMPANIES)
CREATE TABLE IF NOT EXISTS public.companies (
  id SERIAL PRIMARY KEY,
  row_number INT,
  empresa TEXT NOT NULL UNIQUE,
  cnpj TEXT,
  uf TEXT,
  logo TEXT,
  plano_campanha TEXT,
  corretores_1 TEXT,
  corretores_2 TEXT,
  corretores_3 TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_companies_updated_at ON public.companies;
CREATE TRIGGER trg_companies_updated_at
BEFORE UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 5. TABELA: CORRETORES (BROKERS)
CREATE TABLE IF NOT EXISTS public.brokers (
  id SERIAL PRIMARY KEY,
  row_number INT,
  corretor_1 TEXT NOT NULL UNIQUE,
  imagem TEXT,
  email TEXT,
  telefone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_brokers_updated_at ON public.brokers;
CREATE TRIGGER trg_brokers_updated_at
BEFORE UPDATE ON public.brokers
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 6. TABELA: POLÍTICAS DE AGENCIAMENTO (AGENCY POLICIES - RN-08)
CREATE TABLE IF NOT EXISTS public.agency_policies (
  id SERIAL PRIMARY KEY,
  row_number INT,
  politica_agenciamento TEXT NOT NULL UNIQUE,
  agenciamento TEXT,
  vitalicio TEXT,
  parcelas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_agency_policies_updated_at ON public.agency_policies;
CREATE TRIGGER trg_agency_policies_updated_at
BEFORE UPDATE ON public.agency_policies
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 7. TABELA: MODELOS DE COPARTICIPAÇÃO (COPARTICIPATION POLICIES - RN-09)
CREATE TABLE IF NOT EXISTS public.coparticipation_policies (
  id SERIAL PRIMARY KEY,
  row_number INT,
  id_politica TEXT,
  nome_politica TEXT NOT NULL UNIQUE,
  percentual_desconto_evento TEXT,
  qnt_partida_evento TEXT,
  valor_consulta_eletiva TEXT,
  valor_consulta_emergencia TEXT,
  valor_exames_simples TEXT,
  valor_exames_complexos TEXT,
  valor_terapia TEXT,
  imagem TEXT,
  terapia TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_coparticipation_policies_updated_at ON public.coparticipation_policies;
CREATE TRIGGER trg_coparticipation_policies_updated_at
BEFORE UPDATE ON public.coparticipation_policies
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 8. TABELA: CAMPANHAS COMERCIAIS (CAMPAIGNS)
CREATE TABLE IF NOT EXISTS public.campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'Campanha Encerrada',
  year INT,
  count INT DEFAULT 0,
  competencias TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON public.campaigns;
CREATE TRIGGER trg_campaigns_updated_at
BEFORE UPDATE ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 9. TABELA: PROPOSTAS E COTAÇÕES (PROPOSALS)
CREATE TABLE IF NOT EXISTS public.proposals (
  id TEXT PRIMARY KEY,
  row_number INT,
  codigo_proposta TEXT,
  data_da_prospeccao TEXT,
  empresa TEXT NOT NULL,
  empresa_id INT REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE SET NULL,
  cnpj TEXT,
  competencia TEXT,
  vidas TEXT,
  vidas_num INT,
  cidade TEXT,
  uf TEXT,
  tkm TEXT,
  tkm_num NUMERIC(12,2),
  faturamento TEXT,
  faturamento_num NUMERIC(14,2),
  acomodacao TEXT,
  fator_moderador TEXT,
  politica_coparticipacao TEXT,
  politica_coparticipacao_id INT REFERENCES public.coparticipation_policies(id) ON UPDATE CASCADE ON DELETE SET NULL,
  corretores_1 TEXT,
  agenciamento_1 TEXT,
  vitalicio_1 TEXT,
  corretores_2 TEXT,
  agenciamento_2 TEXT,
  vitalicio_2 TEXT,
  corretores_3 TEXT,
  agenciamento_3 TEXT,
  vitalicio_3 TEXT,
  plano_campanha TEXT,
  status_campanha TEXT,
  temperatura_contrato TEXT DEFAULT 'Iniciada',
  aptidao TEXT DEFAULT 'Apto',
  usuario TEXT,
  data_inclusao TEXT,
  hora_inclusao TEXT,
  tipo_contrato TEXT,
  qnt_faixa_etaria TEXT,
  faixa_etaria TEXT,
  data_analise_tecnica TEXT,
  data_avaliacao_diretoria TEXT,
  data_envio_corretor TEXT,
  motivo_declinio TEXT,
  observacao TEXT,
  conversao_solus TEXT,
  status_contrato TEXT,
  plataforma TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger de cálculo financeiro e aptidão na proposta
CREATE OR REPLACE FUNCTION public.sync_proposal_financials()
RETURNS TRIGGER AS $$
BEGIN
  -- Se vidas ou tkm numéricos forem informados
  IF NEW.vidas_num IS NOT NULL AND NEW.tkm_num IS NOT NULL THEN
    NEW.faturamento_num = ROUND((NEW.vidas_num * NEW.tkm_num)::numeric, 2);
  END IF;

  -- Sincronizar aptidão comercial conforme regra RN-05
  IF NEW.temperatura_contrato = 'Desistência da Empresa' OR NEW.temperatura_contrato = 'Declinado pela SB Saúde' THEN
    NEW.aptidao = 'Inapto';
  ELSE
    NEW.aptidao = 'Apto';
  END IF;

  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proposals_financials ON public.proposals;
CREATE TRIGGER trg_proposals_financials
BEFORE INSERT OR UPDATE ON public.proposals
FOR EACH ROW EXECUTE FUNCTION public.sync_proposal_financials();

-- 10. TABELA: USUÁRIOS & GOVERNANÇA (USERS)
CREATE TABLE IF NOT EXISTS public.users (
  id SERIAL PRIMARY KEY,
  row_number INT,
  user_code TEXT,
  username TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  role TEXT,
  profile TEXT,
  status TEXT DEFAULT 'Ativo',
  password_hash TEXT,
  two_factor BOOLEAN DEFAULT TRUE,
  last_login TEXT,
  ip TEXT,
  avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir colunas adicionais em bancos existentes
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS user_code TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Ativo';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS two_factor BOOLEAN DEFAULT TRUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar TEXT;

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 11. TABELA: RELATÓRIOS SALVOS (SAVED REPORTS)
CREATE TABLE IF NOT EXISTS public.saved_reports (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  source TEXT,
  group_by TEXT,
  metric TEXT,
  date_from TEXT,
  date_to TEXT,
  user_login TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_saved_reports_updated_at ON public.saved_reports;
CREATE TRIGGER trg_saved_reports_updated_at
BEFORE UPDATE ON public.saved_reports
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 12. TABELA: MATRIZ DE REQUISITOS (SYSTEM REQUIREMENTS)
CREATE TABLE IF NOT EXISTS public.system_requirements (
  id TEXT PRIMARY KEY,
  module TEXT,
  priority TEXT,
  origin TEXT,
  title TEXT,
  behavior TEXT,
  acceptance TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 13. POLÍTICAS DE ROW LEVEL SECURITY (RLS)
-- ==============================================================================
ALTER TABLE public.ufs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coparticipation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_requirements ENABLE ROW LEVEL SECURITY;

DO $$ 
DECLARE
  tbl text;
BEGIN
  FOR tbl IN 
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Public full access" ON public.%I', tbl);
    EXECUTE format('CREATE POLICY "Public full access" ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;

-- 14. ADICIONAR TABELAS À PUBLICAÇÃO REALTIME
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.proposals;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.companies;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coparticipation_policies;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.campaigns;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;
