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

-- Trigger de cálculo financeiro e aptidão na proposta (RN-03 e RN-05)
CREATE OR REPLACE FUNCTION public.sync_proposal_financials()
RETURNS TRIGGER AS $$
BEGIN
  -- Se faturamento_num não foi explicitamente fornecido, calcula a partir de vidas_num e tkm_num
  IF NEW.faturamento_num IS NULL AND NEW.vidas_num IS NOT NULL AND NEW.tkm_num IS NOT NULL THEN
    NEW.faturamento_num = ROUND((NEW.vidas_num * NEW.tkm_num)::numeric, 2);
  END IF;

  -- Sincronizar aptidão comercial conforme regra RN-05:
  -- Status vazio -> aptidão vazia; 'Declinado pela SB Saúde' -> 'Inapto'; demais status preenchidos (inclusive desistências) -> 'Apto'
  IF NEW.temperatura_contrato IS NULL OR TRIM(NEW.temperatura_contrato) = '' THEN
    NEW.aptidao = '';
  ELSIF TRIM(NEW.temperatura_contrato) = 'Declinado pela SB Saúde' THEN
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

-- Função RPC: Autenticação Segura via PostgreSQL e pgcrypto
CREATE OR REPLACE FUNCTION public.auth_login(p_user text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user record;
  v_password_valid boolean := false;
  v_stored_hash text;
  v_headers jsonb;
  v_client_ip text;
  v_ip_source text;
  v_session_token text;
BEGIN
  -- Extrair IP para auditoria
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
    v_client_ip := COALESCE(
      v_headers ->> 'cf-connecting-ip',
      v_headers ->> 'x-real-ip',
      SPLIT_PART(v_headers ->> 'x-forwarded-for', ',', 1)
    );
    v_client_ip := TRIM(v_client_ip);
    IF v_client_ip IS NOT NULL AND v_client_ip <> '' THEN
      IF v_client_ip ~ '^(127\.|172\.(1[6-9]|2[0-9]|3[01])\.|10\.|192\.168\.)' THEN
        v_ip_source := 'LAN/Proxy Interno';
      ELSE
        v_ip_source := 'Origem Verificada';
      END IF;
    ELSE
      v_client_ip := NULL;
      v_ip_source := 'Origem não verificada';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_client_ip := NULL;
    v_ip_source := 'Origem não verificada';
  END;

  -- Validação de presença de credenciais (identificador normalizado, senha preservada exatamente)
  IF p_user IS NULL OR TRIM(p_user) = '' OR p_password IS NULL OR p_password = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_CREDENTIALS',
      'message', 'Por favor, informe seu usuário ou e-mail e a senha de acesso.'
    );
  END IF;

  -- Busca por username ou email (case-insensitive e com trim apenas no identificador)
  SELECT * INTO v_user
  FROM public.users
  WHERE LOWER(TRIM(username)) = LOWER(TRIM(p_user))
     OR LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(p_user))
  LIMIT 1;

  -- Usuário inexistente
  IF v_user IS NULL THEN
    BEGIN
      INSERT INTO public.user_login_events (username, ip_address, ip_source, is_success, failure_reason)
      VALUES (TRIM(p_user), v_client_ip, v_ip_source, false, 'USER_NOT_FOUND');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'USER_NOT_FOUND',
      'message', 'Usuário não encontrado. O acesso é restrito exclusivamente aos usuários cadastrados pelos administradores.'
    );
  END IF;

  -- Usuário inativo ou bloqueado
  IF v_user.status IS NOT NULL AND v_user.status != 'Ativo' THEN
    BEGIN
      INSERT INTO public.user_login_events (username, ip_address, ip_source, is_success, failure_reason)
      VALUES (v_user.username, v_client_ip, v_ip_source, false, 'USER_BLOCKED');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'USER_BLOCKED',
      'message', format('Acesso bloqueado. O usuário "%s" está marcado como Inativo ou Bloqueado no painel administrativo.', v_user.name)
    );
  END IF;

  v_stored_hash := COALESCE(v_user.password_hash, '');

  -- Validação de senha: Bcrypt ($2a$, $2b$, $2y$) ou fallback legado com auto-migração
  IF v_stored_hash ~ '^\$2[aby]\$[0-9]{2}\$' THEN
    v_password_valid := (extensions.crypt(p_password, v_stored_hash) = v_stored_hash);
  ELSE
    v_password_valid := (v_stored_hash = p_password);
    -- Se for senha legada válida, auto-migra imediatamente para Bcrypt forte no servidor
    IF v_password_valid THEN
      UPDATE public.users 
      SET password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
          updated_at = NOW()
      WHERE id = v_user.id;
    END IF;
  END IF;

  IF NOT v_password_valid THEN
    BEGIN
      INSERT INTO public.user_login_events (username, ip_address, ip_source, is_success, failure_reason)
      VALUES (v_user.username, v_client_ip, v_ip_source, false, 'INVALID_PASSWORD');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_PASSWORD',
      'message', 'Senha incorreta. Verifique suas credenciais ou solicite a redefinição com o administrador.'
    );
  END IF;

  -- Atualiza último login e captura IP real
  UPDATE public.users 
  SET last_login = to_char(NOW(), 'DD/MM/YYYY HH24:MI:SS'),
      ip = v_client_ip,
      updated_at = NOW()
  WHERE id = v_user.id;

  -- Gerar token de sessão seguro (32 bytes hex)
  v_session_token := encode(extensions.gen_random_bytes(32), 'hex');

  -- Gravar sessão ativa
  INSERT INTO public.user_sessions (user_id, username, token, ip_address, expires_at)
  VALUES (v_user.id, v_user.username, v_session_token, v_client_ip, NOW() + INTERVAL '24 hours');

  -- Registrar evento de login auditável com sucesso
  INSERT INTO public.user_login_events (username, ip_address, ip_source, is_success, failure_reason)
  VALUES (v_user.username, v_client_ip, v_ip_source, true, NULL);

  -- Retorna dados completos SEM password_hash
  RETURN jsonb_build_object(
    'success', true,
    'session_token', v_session_token,
    'user', jsonb_build_object(
      'id', COALESCE(v_user.user_code, 'USR-' || LPAD(v_user.id::text, 3, '0')),
      'login', v_user.username,
      'name', COALESCE(v_user.name, v_user.username),
      'email', COALESCE(v_user.email, LOWER(v_user.username) || '@sbsaude.com.br'),
      'role', COALESCE(v_user.role, 'Consultor Comercial'),
      'profile', COALESCE(v_user.profile, 'Consultor Comercial'),
      'status', v_user.status,
      'twoFactor', COALESCE(v_user.two_factor, true),
      'avatar', COALESCE(v_user.avatar, UPPER(SUBSTRING(COALESCE(v_user.name, v_user.username) from 1 for 2))),
      'lastLogin', to_char(NOW(), 'DD/MM/YYYY HH24:MI:SS'),
      'ip', v_client_ip
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.auth_login(text, text) TO anon, authenticated, service_role, postgres, public;

-- TABELAS DE SESSÕES E EVENTOS DE AUTENTICAÇÃO
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id INT REFERENCES public.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_revoked BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS public.user_login_events (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  login_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  ip_source TEXT,
  user_agent TEXT,
  is_success BOOLEAN NOT NULL,
  failure_reason TEXT
);

-- FUNÇÃO RPC: REDEFINIÇÃO SEGURA DE SENHA PELO ADMINISTRADOR
CREATE OR REPLACE FUNCTION public.admin_reset_password(
  p_session_token text,
  p_target_username text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin_session record;
  v_target_user record;
  v_hashed_password text;
  v_updated_at text;
BEGIN
  IF p_session_token IS NULL OR TRIM(p_session_token) = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED', 'message', 'Sessão administrativa não informada.');
  END IF;

  SELECT s.*, u.profile, u.status AS user_status, u.username AS admin_username
  INTO v_admin_session
  FROM public.user_sessions s
  JOIN public.users u ON u.id = s.user_id
  WHERE s.token = p_session_token
    AND s.is_revoked = false
    AND s.expires_at > NOW()
  LIMIT 1;

  IF v_admin_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_SESSION', 'message', 'Sessão inválida ou expirada. Efetue login novamente.');
  END IF;

  IF v_admin_session.profile <> 'Administrador Master' OR v_admin_session.user_status <> 'Ativo' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'Acesso negado: operação restrita a Administrador Master ativo.');
  END IF;

  SELECT * INTO v_target_user
  FROM public.users
  WHERE LOWER(TRIM(username)) = LOWER(TRIM(p_target_username))
  LIMIT 1;

  IF v_target_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'USER_NOT_FOUND', 'message', 'Usuário alvo não encontrado.');
  END IF;

  -- Validação de tamanho mínimo sem cortar espaços
  IF p_new_password IS NULL OR LENGTH(p_new_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WEAK_PASSWORD', 'message', 'A nova senha deve possuir no mínimo 6 caracteres.');
  END IF;

  v_hashed_password := extensions.crypt(p_new_password, extensions.gen_salt('bf', 10));
  v_updated_at := to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  UPDATE public.users
  SET password_hash = v_hashed_password,
      updated_at = NOW()
  WHERE id = v_target_user.id;

  -- Revogar todas as sessões anteriores do usuário alvo
  UPDATE public.user_sessions
  SET is_revoked = true
  WHERE username = v_target_user.username;

  -- Auditoria
  INSERT INTO public.user_login_events (username, ip_address, ip_source, is_success, failure_reason)
  VALUES (v_target_user.username, v_admin_session.ip_address, 'Admin Password Reset by ' || v_admin_session.admin_username, true, NULL);

  RETURN jsonb_build_object(
    'success', true,
    'target_username', v_target_user.username,
    'updated_at', v_updated_at,
    'sessions_revoked', true,
    'message', format('Senha do usuário %s redefinida e criptografada com sucesso no servidor.', v_target_user.username)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reset_password(text, text, text) TO anon, authenticated, service_role, postgres, public;

-- FUNÇÃO RPC: SALVAMENTO E ATUALIZAÇÃO SEGURA DE PERFIL DE USUÁRIO
CREATE OR REPLACE FUNCTION public.admin_save_user(
  p_session_token text,
  p_user_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin_session record;
  v_target_user record;
  v_username text;
  v_name text;
  v_email text;
  v_role text;
  v_profile text;
  v_status text;
  v_user_code text;
  v_two_factor boolean;
  v_avatar text;
  v_raw_pwd text;
  v_new_hash text;
BEGIN
  SELECT s.*, u.profile, u.status AS user_status
  INTO v_admin_session
  FROM public.user_sessions s
  JOIN public.users u ON u.id = s.user_id
  WHERE s.token = p_session_token
    AND s.is_revoked = false
    AND s.expires_at > NOW()
  LIMIT 1;

  IF v_admin_session IS NULL OR v_admin_session.profile <> 'Administrador Master' OR v_admin_session.user_status <> 'Ativo' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'Acesso negado: operação restrita a Administrador Master ativo.');
  END IF;

  v_username := UPPER(TRIM(COALESCE(p_user_data->>'username', p_user_data->>'login', '')));
  IF v_username = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_DATA', 'message', 'Username / login é obrigatório.');
  END IF;

  v_name := COALESCE(p_user_data->>'name', v_username);
  v_email := COALESCE(p_user_data->>'email', LOWER(v_username) || '@sbsaude.com.br');
  v_role := COALESCE(p_user_data->>'role', 'Consultor Comercial');
  v_profile := COALESCE(p_user_data->>'profile', v_role);
  v_status := COALESCE(p_user_data->>'status', 'Ativo');
  v_user_code := p_user_data->>'user_code';
  v_two_factor := COALESCE((p_user_data->>'two_factor')::boolean, (p_user_data->>'twoFactor')::boolean, true);
  v_avatar := p_user_data->>'avatar';

  SELECT * INTO v_target_user
  FROM public.users
  WHERE username = v_username
  LIMIT 1;

  IF FOUND THEN
    -- Edição de perfil: NUNCA altera password_hash, last_login ou ip!
    UPDATE public.users
    SET name = COALESCE(p_user_data->>'name', v_target_user.name),
        email = COALESCE(p_user_data->>'email', v_target_user.email),
        role = COALESCE(p_user_data->>'role', v_target_user.role),
        profile = COALESCE(p_user_data->>'profile', v_target_user.profile),
        status = COALESCE(p_user_data->>'status', v_target_user.status),
        user_code = COALESCE(p_user_data->>'user_code', v_target_user.user_code),
        two_factor = COALESCE((p_user_data->>'two_factor')::boolean, (p_user_data->>'twoFactor')::boolean, v_target_user.two_factor),
        avatar = COALESCE(p_user_data->>'avatar', v_target_user.avatar),
        updated_at = NOW()
    WHERE id = v_target_user.id;

    IF COALESCE(p_user_data->>'status', v_target_user.status) <> 'Ativo' THEN
      UPDATE public.user_sessions SET is_revoked = true WHERE username = v_username;
    END IF;

    RETURN jsonb_build_object('success', true, 'action', 'updated', 'username', v_username);
  ELSE
    -- Criação de novo usuário com hash Bcrypt forte
    v_raw_pwd := COALESCE(p_user_data->>'password', 'SbSaude@2026');
    v_new_hash := extensions.crypt(v_raw_pwd, extensions.gen_salt('bf', 10));

    INSERT INTO public.users (
      user_code, username, name, email, role, profile, status, password_hash, two_factor, avatar
    ) VALUES (
      COALESCE(v_user_code, 'USR-' || LPAD((COALESCE((SELECT MAX(id) FROM public.users), 0) + 1)::text, 3, '0')),
      v_username, v_name, v_email, v_role, v_profile, v_status, v_new_hash, v_two_factor, v_avatar
    );

    RETURN jsonb_build_object('success', true, 'action', 'created', 'username', v_username);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_save_user(text, jsonb) TO anon, authenticated, service_role, postgres, public;

-- FUNÇÃO RPC: EXCLUSÃO SEGURA DE USUÁRIO
CREATE OR REPLACE FUNCTION public.admin_delete_user(
  p_session_token text,
  p_target_username text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin_session record;
BEGIN
  SELECT s.*, u.profile, u.status AS user_status, u.username as admin_username
  INTO v_admin_session
  FROM public.user_sessions s
  JOIN public.users u ON u.id = s.user_id
  WHERE s.token = p_session_token
    AND s.is_revoked = false
    AND s.expires_at > NOW()
  LIMIT 1;

  IF v_admin_session IS NULL OR v_admin_session.profile <> 'Administrador Master' OR v_admin_session.user_status <> 'Ativo' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'Acesso negado: operação restrita a Administrador Master ativo.');
  END IF;

  IF UPPER(TRIM(p_target_username)) = UPPER(TRIM(v_admin_session.admin_username)) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'CANNOT_DELETE_SELF', 'message', 'Não é permitido excluir a própria conta conectada.');
  END IF;

  UPDATE public.user_sessions SET is_revoked = true WHERE username = UPPER(TRIM(p_target_username));
  DELETE FROM public.users WHERE username = UPPER(TRIM(p_target_username));

  RETURN jsonb_build_object('success', true, 'message', 'Usuário excluído com sucesso.');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(text, text) TO anon, authenticated, service_role, postgres, public;

-- FUNÇÃO RPC: LOGOUT E ENCERRAMENTO DE SESSÃO
CREATE OR REPLACE FUNCTION public.auth_logout(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_session_token IS NOT NULL THEN
    UPDATE public.user_sessions
    SET is_revoked = true
    WHERE token = p_session_token;
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.auth_logout(text) TO anon, authenticated, service_role, postgres, public;

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
-- 13. POLÍTICAS DE ROW LEVEL SECURITY (RLS) E SEGURANÇA RESTRITA
-- ==============================================================================
ALTER TABLE public.ufs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coparticipation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_requirements ENABLE ROW LEVEL SECURITY;

-- Aplicar políticas públicas apenas sobre entidades de negócio (propostas, empresas, corretores, etc.)
DO $$ 
DECLARE
  tbl text;
BEGIN
  FOR tbl IN 
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename NOT IN ('users', 'user_sessions', 'user_login_events', '_backup_users_pre_remediation')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Public full access" ON public.%I', tbl);
    EXECUTE format('CREATE POLICY "Public full access" ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;

-- POLÍTICAS RESTRITAS PARA USERS (NUNCA EXPÕE PASSWORD_HASH NEM PERMITE ESCRITA ANÔNIMA)
DROP POLICY IF EXISTS "Public full access" ON public.users;
DROP POLICY IF EXISTS "Users read safe columns" ON public.users;
CREATE POLICY "Users read safe columns" ON public.users 
  FOR SELECT TO anon, authenticated 
  USING (true);

-- Permissões a nível de coluna: anon e authenticated nunca podem ler password_hash nem gravar diretamente em users
REVOKE ALL ON public.users FROM anon, authenticated, public;
GRANT SELECT (id, row_number, user_code, username, name, email, role, profile, status, two_factor, last_login, ip, avatar, created_at, updated_at) 
  ON public.users TO anon, authenticated;
GRANT ALL ON public.users TO postgres, service_role;

REVOKE ALL ON public.user_sessions FROM anon, authenticated, public;
GRANT ALL ON public.user_sessions TO postgres, service_role;

REVOKE ALL ON public.user_login_events FROM anon, authenticated, public;
GRANT ALL ON public.user_login_events TO postgres, service_role;

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
