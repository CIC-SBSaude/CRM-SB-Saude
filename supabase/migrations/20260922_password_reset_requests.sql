-- =========================================================================
-- Migração Versionada: Solicitações de Redefinição de Senha e Fila Administrativa
-- Data: 2026-09-22
-- =========================================================================

-- 1. Criação da Tabela public.password_reset_requests
CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  requested_identifier TEXT NOT NULL,
  client_ip TEXT,
  ip_source TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'resolvida', 'cancelada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by_admin TEXT,
  notes TEXT
);

-- Índices para performance e consultas operacionais
CREATE INDEX IF NOT EXISTS idx_pwd_reset_requests_status ON public.password_reset_requests(status);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_requests_user_id ON public.password_reset_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_requests_created_at ON public.password_reset_requests(created_at DESC);

-- Habilitar RLS estrito
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

-- Revogar acesso direto (SELECT, INSERT, UPDATE, DELETE) para anon e authenticated.
-- O acesso será estritamente mediado pelas funções SECURITY DEFINER.
REVOKE ALL ON public.password_reset_requests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.password_reset_requests TO postgres, service_role;

-- Incluir na publicação do Supabase Realtime para notificações instantâneas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'password_reset_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.password_reset_requests;
  END IF;
END $$;

-- 2. RPC Pública: request_password_reset
--    - Invocada a partir da tela de login por usuários não autenticados
--    - Não revela se o usuário existe ou não (resposta uniforme)
--    - Previne spam/duplicidades (se houver pedido pendente recente, não insere duplicata)
--    - Nunca armazena senhas, apenas metadados de solicitação
CREATE OR REPLACE FUNCTION public.request_password_reset(p_identifier text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_headers jsonb;
  v_client_ip text;
  v_ip_source text;
  v_clean_identifier text;
  v_user record;
  v_existing_id bigint;
  v_uniform_message constant text := 'Solicitação recebida. Se o usuário informado estiver cadastrado, ela foi encaminhada aos administradores. Entre em contato com um administrador para acompanhar a redefinição da senha.';
BEGIN
  -- Extrair IP da requisição
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
      v_client_ip := '127.0.0.1';
      v_ip_source := 'Loopback Local';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_client_ip := '127.0.0.1';
    v_ip_source := 'Indeterminado';
  END;

  v_clean_identifier := TRIM(COALESCE(p_identifier, ''));
  IF v_clean_identifier = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'EMPTY_IDENTIFIER',
      'message', 'Por favor, informe seu usuário ou e-mail institucional.'
    );
  END IF;

  -- Localizar usuário por username ou email (case-insensitive)
  SELECT id, username, email, status, name
  INTO v_user
  FROM public.users
  WHERE LOWER(TRIM(username)) = LOWER(v_clean_identifier)
     OR LOWER(TRIM(COALESCE(email, ''))) = LOWER(v_clean_identifier)
  LIMIT 1;

  -- Se não encontrar o usuário, retorna resposta uniforme sem inserir registro
  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', v_uniform_message
    );
  END IF;

  -- Prevenção de duplicidade: se já existir solicitação PENDENTE para este usuário nas últimas 24h
  SELECT id INTO v_existing_id
  FROM public.password_reset_requests
  WHERE user_id = v_user.id
    AND status = 'pendente'
    AND created_at > (NOW() - INTERVAL '24 hours')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Já existe solicitação aberta; retorna sucesso uniforme sem criar duplicata de spam
    RETURN jsonb_build_object(
      'success', true,
      'message', v_uniform_message
    );
  END IF;

  -- Inserir nova solicitação auditável
  INSERT INTO public.password_reset_requests (
    user_id,
    username,
    requested_identifier,
    client_ip,
    ip_source,
    status
  ) VALUES (
    v_user.id,
    v_user.username,
    v_clean_identifier,
    v_client_ip,
    v_ip_source,
    'pendente'
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', v_uniform_message
  );
END;
$$;

-- 3. RPC Administrativa: admin_list_password_reset_requests
--    - Acessível exclusivamente por Administrador Master com sessão ativa
--    - Retorna a lista de solicitações com informações do usuário solicitante
CREATE OR REPLACE FUNCTION public.admin_list_password_reset_requests(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin_session record;
  v_requests jsonb;
BEGIN
  -- Validar token de sessão do administrador chamador
  SELECT s.*, u.profile, u.status AS user_status, u.username as admin_username
  INTO v_admin_session
  FROM public.user_sessions s
  JOIN public.users u ON u.id = s.user_id
  WHERE s.token = p_session_token
    AND s.is_revoked = false
    AND s.expires_at > NOW()
  LIMIT 1;

  IF v_admin_session IS NULL OR v_admin_session.profile <> 'Administrador Master' OR v_admin_session.user_status <> 'Ativo' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'message', 'Acesso negado: operação restrita a Administrador Master ativo.'
    );
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'user_id', r.user_id,
        'username', r.username,
        'user_name', u.name,
        'user_email', u.email,
        'user_role', u.role,
        'user_profile', u.profile,
        'requested_identifier', r.requested_identifier,
        'client_ip', r.client_ip,
        'ip_source', r.ip_source,
        'status', r.status,
        'created_at', to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'resolved_at', to_char(r.resolved_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'resolved_by_admin', r.resolved_by_admin,
        'notes', r.notes
      ) ORDER BY 
        CASE WHEN r.status = 'pendente' THEN 0 ELSE 1 END,
        r.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_requests
  FROM public.password_reset_requests r
  JOIN public.users u ON u.id = r.user_id;

  RETURN jsonb_build_object(
    'success', true,
    'requests', v_requests
  );
END;
$$;

-- 4. RPC Administrativa: admin_resolve_password_reset_request
--    - Permite marcar a solicitação como 'resolvida' (após redefinição) ou 'cancelada' (com justificativa)
--    - Acessível exclusivamente por Administrador Master com sessão ativa
CREATE OR REPLACE FUNCTION public.admin_resolve_password_reset_request(
  p_session_token text,
  p_request_id bigint,
  p_action text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin_session record;
  v_request record;
  v_action_norm text;
BEGIN
  -- Validar token de sessão do administrador chamador
  SELECT s.*, u.profile, u.status AS user_status, u.username as admin_username
  INTO v_admin_session
  FROM public.user_sessions s
  JOIN public.users u ON u.id = s.user_id
  WHERE s.token = p_session_token
    AND s.is_revoked = false
    AND s.expires_at > NOW()
  LIMIT 1;

  IF v_admin_session IS NULL OR v_admin_session.profile <> 'Administrador Master' OR v_admin_session.user_status <> 'Ativo' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'message', 'Acesso negado: operação restrita a Administrador Master ativo.'
    );
  END IF;

  v_action_norm := LOWER(TRIM(p_action));
  IF v_action_norm NOT IN ('resolvida', 'cancelada') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_ACTION',
      'message', 'Ação inválida. Valores aceitos: resolvida, cancelada.'
    );
  END IF;

  SELECT * INTO v_request
  FROM public.password_reset_requests
  WHERE id = p_request_id
  LIMIT 1;

  IF v_request IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'REQUEST_NOT_FOUND',
      'message', 'Solicitação de redefinição não encontrada.'
    );
  END IF;

  -- Se for cancelamento, exigir ou sugerir notas
  UPDATE public.password_reset_requests
  SET status = v_action_norm,
      resolved_at = NOW(),
      resolved_by_admin = v_admin_session.admin_username,
      notes = COALESCE(p_notes, notes)
  WHERE id = p_request_id;

  -- Auditoria
  INSERT INTO public.user_login_events (username, ip_address, ip_source, is_success, failure_reason)
  VALUES (
    v_request.username,
    v_admin_session.ip_address,
    format('Password Reset Request #%s %s by %s', p_request_id, v_action_norm, v_admin_session.admin_username),
    true,
    NULL
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'status', v_action_norm,
    'resolved_by', v_admin_session.admin_username,
    'resolved_at', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
END;
$$;

-- 5. Conceder permissões de execução
GRANT EXECUTE ON FUNCTION public.request_password_reset(text) TO anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_password_reset_requests(text) TO anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.admin_resolve_password_reset_request(text, bigint, text, text) TO anon, authenticated, postgres, service_role;
