const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const SUPABASE_URL = 'http://127.0.0.1:56321';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const PG_CONN = 'postgresql://postgres:postgres@127.0.0.1:56322/postgres';

const EXPECTED_UNIFORM_MESSAGE = 'Solicitação recebida. Se o usuário informado estiver cadastrado, ela foi encaminhada aos administradores. Entre em contato com um administrador para acompanhar a redefinição da senha.';

async function runPasswordResetTests() {
  console.log('================================================================');
  console.log('TEST SUITE: FLUXO DE SOLICITAÇÃO DE REDEFINIÇÃO DE SENHA (CRM SB SAÚDE)');
  console.log('================================================================\n');

  const pgClient = new Client({ connectionString: PG_CONN });
  await pgClient.connect();
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  try {
    // 0. Limpeza prévia para isolamento dos testes
    await pgClient.query("DELETE FROM public.password_reset_requests WHERE username IN ('ADMINISTRADOR', 'TESTE_RESET_USER', 'TESTE_RESET_CANC');");
    await pgClient.query("DELETE FROM public.users WHERE username IN ('TESTE_RESET_USER', 'TESTE_RESET_CANC');");

    // Criação de usuário para testes de ponta a ponta
    await pgClient.query(`
      INSERT INTO public.users (username, name, email, role, profile, status, password_hash)
      VALUES 
        ('TESTE_RESET_USER', 'Usuário Teste Redefinição', 'teste.reset@sbsaude.com.br', 'Consultor Comercial', 'Consultor Comercial', 'Ativo', extensions.crypt('Senha@123', extensions.gen_salt('bf', 10))),
        ('TESTE_RESET_CANC', 'Usuário Teste Cancelamento', 'teste.canc@sbsaude.com.br', 'Analista de Operações', 'Analista de Operações', 'Ativo', extensions.crypt('Senha@456', extensions.gen_salt('bf', 10)));
    `);

    // -------------------------------------------------------------
    // Teste 1: Solicitação com Usuário Válido (por login e por e-mail)
    // -------------------------------------------------------------
    console.log('▶ Teste 1: Solicitação pública com usuário válido');
    const { data: resUser, error: errUser } = await supabase.rpc('request_password_reset', {
      p_identifier: 'TESTE_RESET_USER'
    });
    assert.strictEqual(errUser, null, 'RPC request_password_reset não deve emitir erro');
    assert.strictEqual(resUser.success, true, 'Deve retornar success = true');
    assert.strictEqual(resUser.message, EXPECTED_UNIFORM_MESSAGE, 'Mensagem deve ser a resposta padronizada uniforme');

    // Valida no banco PostgreSQL se o registro foi criado corretamente
    const checkDb = await pgClient.query(
      "SELECT * FROM public.password_reset_requests WHERE username = 'TESTE_RESET_USER' AND status = 'pendente';"
    );
    assert.strictEqual(checkDb.rows.length, 1, 'Deve existir exatamente 1 registro pendente no banco');
    const reqRow = checkDb.rows[0];
    assert.strictEqual(reqRow.requested_identifier, 'TESTE_RESET_USER');
    assert.strictEqual(reqRow.status, 'pendente');
    assert.strictEqual(reqRow.password, undefined, 'A tabela não deve conter campo de senha');
    assert.strictEqual(reqRow.token, undefined, 'A tabela não deve conter tokens gerados em texto');
    console.log('  ✓ Solicitação persistida com status pendente e dados íntegros.');

    // -------------------------------------------------------------
    // Teste 2: Anti-enumeração — Solicitação com Usuário Inexistente
    // -------------------------------------------------------------
    console.log('\n▶ Teste 2: Proteção contra enumeração de contas (usuário inexistente)');
    const { data: resNonExistent, error: errNonExistent } = await supabase.rpc('request_password_reset', {
      p_identifier: 'usuario_inexistente_xyz_999@sbsaude.com.br'
    });
    assert.strictEqual(errNonExistent, null);
    assert.strictEqual(resNonExistent.success, true);
    assert.strictEqual(resNonExistent.message, EXPECTED_UNIFORM_MESSAGE, 'Resposta deve ser rigorosamente idêntica');

    const checkGhost = await pgClient.query(
      "SELECT * FROM public.password_reset_requests WHERE requested_identifier = 'usuario_inexistente_xyz_999@sbsaude.com.br';"
    );
    assert.strictEqual(checkGhost.rows.length, 0, 'Nenhum registro deve ser criado para conta inexistente');
    console.log('  ✓ Usuário inexistente recebe mensagem idêntica sem geração de ruído no banco.');

    // -------------------------------------------------------------
    // Teste 3: Anti-Spam / Rate-limiting (Solicitações duplicadas)
    // -------------------------------------------------------------
    console.log('\n▶ Teste 3: Rate-limiting / Anti-spam (duplicidade em 24h)');
    const { data: resDup, error: errDup } = await supabase.rpc('request_password_reset', {
      p_identifier: 'teste.reset@sbsaude.com.br' // Mesmo usuário, via e-mail
    });
    assert.strictEqual(errDup, null);
    assert.strictEqual(resDup.success, true);
    assert.strictEqual(resDup.message, EXPECTED_UNIFORM_MESSAGE);

    const checkDupCount = await pgClient.query(
      "SELECT count(*) as total FROM public.password_reset_requests WHERE username = 'TESTE_RESET_USER' AND status = 'pendente';"
    );
    assert.strictEqual(parseInt(checkDupCount.rows[0].total, 10), 1, 'Não deve criar linha duplicada se já houver solicitação pendente recente');
    console.log('  ✓ Anti-spam validado: contagem de solicitações pendentes mantida em 1.');

    // -------------------------------------------------------------
    // Teste 4: Segurança, RLS e Autorização de Acesso
    // -------------------------------------------------------------
    console.log('\n▶ Teste 4: RLS e bloqueio de acesso não autorizado');
    // Consulta direta anônima via REST API
    const { data: anonDirectData, error: anonDirectErr } = await supabase
      .from('password_reset_requests')
      .select('*');
    assert.ok(
      anonDirectErr || (anonDirectData && anonDirectData.length === 0),
      'Acesso anônimo direto à tabela deve falhar ou ser bloqueado pelo RLS'
    );

    // Tentativa de RPC admin com token falso
    const { data: fakeTokenRes, error: fakeTokenErr } = await supabase.rpc('admin_list_password_reset_requests', {
      p_session_token: 'token_falso_hacker_123'
    });
    assert.strictEqual(fakeTokenRes.success, false, 'RPC deve recusar token inválido');
    assert.strictEqual(fakeTokenRes.error_code, 'FORBIDDEN', 'Deve retornar erro de não autorizado / proibido');
    console.log('  ✓ RLS e autorização por token administrativo protegidos com sucesso.');

    // -------------------------------------------------------------
    // Teste 5: Autenticação de Administrador e Listagem de Solicitações
    // -------------------------------------------------------------
    console.log('\n▶ Teste 5: Listagem administrativa de solicitações');
    // Faz login com administrador para obter token de sessão válido
    const loginRes = await supabase.rpc('auth_login', {
      p_user: 'ADMINISTRADOR',
      p_password: 'admin.admin'
    });
    assert.strictEqual(loginRes.data.success, true, 'Login do administrador deve ser bem-sucedido');
    const sessionToken = loginRes.data.session_token;
    assert.ok(sessionToken, 'Deve fornecer um session_token ativo');

    // Listagem como Administrador Master
    const { data: listData, error: listErr } = await supabase.rpc('admin_list_password_reset_requests', {
      p_session_token: sessionToken
    });
    assert.strictEqual(listErr, null);
    assert.strictEqual(listData.success, true);
    assert.ok(Array.isArray(listData.requests), 'Deve retornar array de solicitações');

    const foundReq = listData.requests.find(r => r.username === 'TESTE_RESET_USER');
    assert.ok(foundReq, 'Solicitação do TESTE_RESET_USER deve constar na listagem');
    assert.strictEqual(foundReq.status, 'pendente');
    assert.strictEqual(foundReq.user_name, 'Usuário Teste Redefinição');
    assert.strictEqual(foundReq.user_email, 'teste.reset@sbsaude.com.br');
    assert.strictEqual(foundReq.user_profile, 'Consultor Comercial');
    console.log('  ✓ Listagem administrativa retornou dados enriquecidos com perfil do usuário.');

    // -------------------------------------------------------------
    // Teste 6: Fluxo Completo de Resolução (Redefinição pelo Administrador)
    // -------------------------------------------------------------
    console.log('\n▶ Teste 6: Atendimento e resolução da solicitação com redefinição de senha');
    const newPassword = 'NovaSenhaForte@2026';
    // 6.1 Redefine a senha via RPC admin_reset_password
    const resetRes = await supabase.rpc('admin_reset_password', {
      p_session_token: sessionToken,
      p_target_username: 'TESTE_RESET_USER',
      p_new_password: newPassword
    });
    assert.strictEqual(resetRes.data.success, true, 'admin_reset_password deve ter sucesso');

    // 6.2 Marca a solicitação como resolvida
    const resolveRes = await supabase.rpc('admin_resolve_password_reset_request', {
      p_session_token: sessionToken,
      p_request_id: foundReq.id,
      p_action: 'resolvida',
      p_notes: 'Senha redefinida pelo administrador via painel de governança.'
    });
    assert.strictEqual(resolveRes.data.success, true, 'admin_resolve_password_reset_request deve ter sucesso');

    // 6.3 Valida no banco PostgreSQL
    const checkResolved = await pgClient.query(
      'SELECT status, resolved_by_admin, resolved_at, notes FROM public.password_reset_requests WHERE id = $1;',
      [foundReq.id]
    );
    assert.strictEqual(checkResolved.rows[0].status, 'resolvida');
    assert.strictEqual(checkResolved.rows[0].resolved_by_admin, 'ADMINISTRADOR');
    assert.ok(checkResolved.rows[0].resolved_at, 'resolved_at deve estar preenchido');
    assert.ok(checkResolved.rows[0].notes.includes('redefinida'));

    // 6.4 Valida que o usuário consegue logar com a NOVA senha e NÃO com a antiga
    const testLoginNew = await supabase.rpc('auth_login', {
      p_user: 'TESTE_RESET_USER',
      p_password: newPassword
    });
    assert.strictEqual(testLoginNew.data.success, true, 'Usuário deve autenticar com a nova senha');

    const testLoginOld = await supabase.rpc('auth_login', {
      p_user: 'TESTE_RESET_USER',
      p_password: 'Senha@123'
    });
    assert.strictEqual(testLoginOld.data.success, false, 'Usuário NÃO deve autenticar com a senha antiga');
    console.log('  ✓ Solicitação marcada como resolvida e nova credencial funcional verificada.');

    // -------------------------------------------------------------
    // Teste 7: Fluxo de Cancelamento / Encerramento sem alteração de senha
    // -------------------------------------------------------------
    console.log('\n▶ Teste 7: Encerramento de solicitação (cancelada com justificativa)');
    // 7.1 Cria solicitação para TESTE_RESET_CANC
    await supabase.rpc('request_password_reset', { p_identifier: 'TESTE_RESET_CANC' });
    const getCancReq = await pgClient.query(
      "SELECT id FROM public.password_reset_requests WHERE username = 'TESTE_RESET_CANC' AND status = 'pendente';"
    );
    assert.strictEqual(getCancReq.rows.length, 1);
    const cancId = getCancReq.rows[0].id;

    // 7.2 Administrador cancela com justificativa
    const cancelRes = await supabase.rpc('admin_resolve_password_reset_request', {
      p_session_token: sessionToken,
      p_request_id: cancId,
      p_action: 'cancelada',
      p_notes: 'Solicitação atendida via suporte telefônico a pedido do gestor.'
    });
    assert.strictEqual(cancelRes.data.success, true);

    const checkCanceled = await pgClient.query(
      'SELECT status, resolved_by_admin, notes FROM public.password_reset_requests WHERE id = $1;',
      [cancId]
    );
    assert.strictEqual(checkCanceled.rows[0].status, 'cancelada');
    assert.strictEqual(checkCanceled.rows[0].resolved_by_admin, 'ADMINISTRADOR');
    assert.ok(checkCanceled.rows[0].notes.includes('suporte telefônico'));

    // 7.3 Senha original de TESTE_RESET_CANC deve permanecer válida
    const loginCanc = await supabase.rpc('auth_login', {
      p_user: 'TESTE_RESET_CANC',
      p_password: 'Senha@456'
    });
    assert.strictEqual(loginCanc.data.success, true, 'Senha original deve permanecer intacta');
    console.log('  ✓ Cancelamento registrado em auditoria sem modificação indevida da senha.');

    // -------------------------------------------------------------
    // Teste 8: Validação de Arquivos de Frontend e Ausência de Vazamentos
    // -------------------------------------------------------------
    console.log('\n▶ Teste 8: Integridade do frontend e verificação estática');
    const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
    const clientJs = fs.readFileSync(path.join(__dirname, '../js/supabase-client.js'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(__dirname, '../css/styles.css'), 'utf8');

    assert.ok(indexHtml.includes('id="link-forgot-password"'), 'index.html deve conter #link-forgot-password');
    assert.ok(indexHtml.includes('id="forgot-pwd-modal"'), 'index.html deve conter #forgot-pwd-modal');
    assert.ok(indexHtml.includes('id="inp-forgot-identifier"'), 'index.html deve conter #inp-forgot-identifier');
    assert.ok(indexHtml.includes('id="forgot-success-box"'), 'index.html deve conter #forgot-success-box');

    assert.ok(clientJs.includes('requestPasswordReset'), 'supabase-client.js deve expor requestPasswordReset');
    assert.ok(clientJs.includes('fetchPasswordResetRequests'), 'supabase-client.js deve expor fetchPasswordResetRequests');
    assert.ok(clientJs.includes('resolvePasswordResetRequest'), 'supabase-client.js deve expor resolvePasswordResetRequest');
    assert.ok(clientJs.includes('password_reset_requests'), 'supabase-client.js deve assinar Realtime na tabela');

    assert.ok(appJs.includes('renderPasswordRequestsTab'), 'app.js deve conter renderPasswordRequestsTab');
    assert.ok(appJs.includes('openCancelRequestModal'), 'app.js deve conter openCancelRequestModal');
    assert.ok(appJs.includes('admin-pending-alert-banner'), 'app.js deve exibir banner de alerta para solicitações pendentes');

    assert.ok(stylesCss.includes('.forgot-success-box'), 'styles.css deve conter estilos para o box de sucesso');
    assert.ok(stylesCss.includes('.req-badge-pendente'), 'styles.css deve conter badge pendente');

    console.log('  ✓ Todos os seletores, contratos de API e estilos CSS validados com sucesso.');

    // Limpeza dos dados de teste
    await pgClient.query("DELETE FROM public.password_reset_requests WHERE username IN ('TESTE_RESET_USER', 'TESTE_RESET_CANC');");
    await pgClient.query("DELETE FROM public.users WHERE username IN ('TESTE_RESET_USER', 'TESTE_RESET_CANC');");

    console.log('\n================================================================');
    console.log('TODOS OS 8 TESTES DE REDEFINIÇÃO DE SENHA PASSARAM COM SUCESSO! ✓');
    console.log('================================================================\n');
  } finally {
    await pgClient.end();
  }
}

runPasswordResetTests().catch(err => {
  console.error('\n❌ FALHA NOS TESTES DE REDEFINIÇÃO DE SENHA:', err);
  process.exit(1);
});
