-- =========================================================================
-- Migração Versionada: Hardening de Validação de Senha, RPCs de Autenticação e Redefinição
-- Data: 2026-09-22
-- =========================================================================

-- 1. Atualizar public.auth_login
--    - Não aplica TRIM(p_password) (preserva espaços legítimos da senha)
--    - Suporta variantes Bcrypt $2a$, $2b$ e $2y$
--    - Registra tentativa de falha em public.user_login_events para auditoria
--    - Retorna error_codes precisos (INVALID_CREDENTIALS, USER_NOT_FOUND, USER_BLOCKED, INVALID_PASSWORD)
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

-- 2. Atualizar public.admin_reset_password
--    - Não aplica TRIM na nova senha (preserva espaços intencionais)
--    - Exige no mínimo 6 caracteres
--    - Criptografa exclusivamente via pgcrypto (gen_salt('bf', 10))
--    - Revoga todas as sessões anteriores do usuário alvo
--    - Retorna metadados de confirmação para verificação autorizada
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

  -- Localizar usuário alvo
  SELECT * INTO v_target_user
  FROM public.users
  WHERE LOWER(TRIM(username)) = LOWER(TRIM(p_target_username))
  LIMIT 1;

  IF v_target_user IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'USER_NOT_FOUND',
      'message', 'Usuário alvo não encontrado.'
    );
  END IF;

  -- Política de senhas: comprimento mínimo de 6 caracteres sem cortar espaços
  IF p_new_password IS NULL OR LENGTH(p_new_password) < 6 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'WEAK_PASSWORD',
      'message', 'A nova senha deve possuir no mínimo 6 caracteres.'
    );
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

  -- Auditoria de segurança
  INSERT INTO public.user_login_events (username, ip_address, ip_source, is_success, failure_reason)
  VALUES (
    v_target_user.username,
    v_admin_session.ip_address,
    'Admin Password Reset by ' || v_admin_session.admin_username,
    true,
    NULL
  );

  RETURN jsonb_build_object(
    'success', true,
    'target_username', v_target_user.username,
    'updated_at', v_updated_at,
    'sessions_revoked', true,
    'message', format('Senha do usuário %s redefinida e criptografada com sucesso no servidor.', v_target_user.username)
  );
END;
$$;

-- 3. Garantir permissões de execução
GRANT EXECUTE ON FUNCTION public.auth_login(text, text) TO anon, authenticated, service_role, postgres, public;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(text, text, text) TO anon, authenticated, service_role, postgres, public;

-- 4. Notificar PostgREST para recarregar o schema cache
NOTIFY pgrst, 'reload schema';
