const assert = require('assert');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

async function runTests() {
  console.log('--- Executando Testes de Integração Supabase (127.0.0.1:56322) ---');

  // Teste 1: Conexão direta PostgreSQL
  const pgClient = new Client({
    host: '127.0.0.1',
    port: 56322,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres'
  });
  await pgClient.connect();
  console.log('✓ Teste 1: Conexão PostgreSQL direta estabelecida.');

  // Teste 2: Contagem de tabelas e integridade
  const tablesCheck = await pgClient.query(`
    SELECT
      (SELECT COUNT(*) FROM public.companies) AS companies_count,
      (SELECT COUNT(*) FROM public.brokers) AS brokers_count,
      (SELECT COUNT(*) FROM public.proposals) AS proposals_count,
      (SELECT COUNT(*) FROM public.coparticipation_policies) AS copart_count,
      (SELECT COUNT(*) FROM public.agency_policies) AS agency_count,
      (SELECT COUNT(*) FROM public.campaigns) AS campaigns_count,
      (SELECT COUNT(*) FROM public.ufs) AS ufs_count,
      (SELECT COUNT(*) FROM public.system_requirements) AS reqs_count
  `);

  const counts = tablesCheck.rows[0];
  assert.strictEqual(parseInt(counts.companies_count, 10), 535, 'Empresas devem ser 535');
  assert.strictEqual(parseInt(counts.brokers_count, 10), 161, 'Corretores devem ser 161');
  assert.strictEqual(parseInt(counts.proposals_count, 10), 1072, 'Propostas devem ser 1072');
  assert.strictEqual(parseInt(counts.ufs_count, 10), 27, 'UFs devem ser 27');
  assert.ok(parseInt(counts.copart_count, 10) >= 2, 'Políticas de coparticipação devem existir');
  assert.ok(parseInt(counts.campaigns_count, 10) >= 20, 'Campanhas devem existir');
  console.log('✓ Teste 2: Integridade de contagens validada (1072 propostas, 535 empresas, 161 corretores, 27 UFs).');

  // Teste 3: Trigger sync_proposal_financials (faturamento e aptidão)
  const testId = 'TEST-INTEGRATION-' + Date.now();
  await pgClient.query(`
    INSERT INTO public.proposals (
      id, empresa, vidas_num, tkm_num, temperatura_contrato
    ) VALUES (
      $1, $2, $3, $4, $5
    )
  `, [testId, 'Empresa Teste Trigger Automático', 50, 200.00, 'Desistência da Empresa']);

  const inserted = await pgClient.query(`SELECT faturamento_num, aptidao FROM public.proposals WHERE id = $1`, [testId]);
  assert.strictEqual(parseFloat(inserted.rows[0].faturamento_num), 10000.00, 'Trigger deve calcular faturamento_num = vidas * tkm');
  assert.strictEqual(inserted.rows[0].aptidao, 'Inapto', 'Trigger deve definir Inapto para Desistência da Empresa');
  console.log('✓ Teste 3.1: Trigger calculou faturamento_num (10.000,00) e aptidao (Inapto) no INSERT.');

  // Atualizar para Em Negociação
  await pgClient.query(`
    UPDATE public.proposals
    SET temperatura_contrato = 'Em Negociação', vidas_num = 100
    WHERE id = $1
  `, [testId]);

  const updated = await pgClient.query(`SELECT faturamento_num, aptidao FROM public.proposals WHERE id = $1`, [testId]);
  assert.strictEqual(parseFloat(updated.rows[0].faturamento_num), 20000.00, 'Trigger deve recalcular faturamento_num = 20000.00');
  assert.strictEqual(updated.rows[0].aptidao, 'Apto', 'Trigger deve atualizar aptidao para Apto');
  console.log('✓ Teste 3.2: Trigger recalculou faturamento_num (20.000,00) e aptidao (Apto) no UPDATE.');

  // Limpar registro de teste
  await pgClient.query(`DELETE FROM public.proposals WHERE id = $1`, [testId]);
  await pgClient.end();
  console.log('✓ Teste 3.3: Limpeza de teste realizada com sucesso.');

  // Teste 4: Supabase JS Client via API Gateway (Kong em 127.0.0.1:56321)
  const SUPABASE_URL = 'http://127.0.0.1:56321';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: supaCompanies, error: compErr } = await supabase.from('companies').select('id, empresa').limit(5);
  assert.strictEqual(compErr, null, 'Consulta REST de empresas via Supabase não deve dar erro');
  assert.strictEqual(supaCompanies.length, 5, 'Deve retornar 5 empresas via Supabase client');
  console.log(`✓ Teste 4.1: Supabase JS Client consultou ${supaCompanies.length} empresas com sucesso via REST API.`);

  const { data: supaProposals, error: propErr } = await supabase.from('proposals').select('id, empresa, faturamento_num').limit(5);
  assert.strictEqual(propErr, null, 'Consulta REST de propostas via Supabase não deve dar erro');
  assert.strictEqual(supaProposals.length, 5, 'Deve retornar 5 propostas via Supabase client');
  console.log(`✓ Teste 4.2: Supabase JS Client consultou ${supaProposals.length} propostas com sucesso via REST API.`);

  // Teste 5: Criação, alteração e exclusão de Usuário no Supabase
  const testUsername = 'TESTE_SBSAÚDE_' + Date.now();
  const testUserRecord = {
    user_code: 'USR-999',
    username: testUsername,
    name: 'Usuário Teste Supabase',
    email: 'teste@sbsaude.com.br',
    role: 'Supervisor Comercial',
    profile: 'Supervisor Comercial',
    status: 'Ativo',
    password_hash: 'Teste@2026',
    two_factor: true,
    last_login: 'Primeiro acesso pendente',
    ip: '192.168.10.99',
    avatar: 'UT'
  };

  const { error: userInsertErr } = await supabase.from('users').upsert(testUserRecord, { onConflict: 'username' });
  assert.strictEqual(userInsertErr, null, 'Inserção de usuário no Supabase não deve dar erro');
  console.log('✓ Teste 5.1: Usuário gravado com sucesso no Supabase.');

  const { data: fetchedUser, error: fetchErr } = await supabase.from('users').select('*').eq('username', testUsername).single();
  assert.strictEqual(fetchErr, null, 'Consulta de usuário recém-criado não deve dar erro');
  assert.strictEqual(fetchedUser.name, 'Usuário Teste Supabase');
  assert.strictEqual(fetchedUser.role, 'Supervisor Comercial');
  assert.strictEqual(fetchedUser.status, 'Ativo');
  console.log('✓ Teste 5.2: Usuário consultado e verificado no Supabase com sucesso.');

  // Atualização de Usuário
  const { error: updateErr } = await supabase.from('users').update({ status: 'Bloqueado' }).eq('username', testUsername);
  assert.strictEqual(updateErr, null, 'Atualização de usuário não deve dar erro');
  const { data: updatedUser } = await supabase.from('users').select('status').eq('username', testUsername).single();
  assert.strictEqual(updatedUser.status, 'Bloqueado', 'Status do usuário deve ter sido atualizado para Bloqueado');
  console.log('✓ Teste 5.3: Usuário atualizado no Supabase com sucesso.');

  // Exclusão de Usuário
  const { error: deleteErr } = await supabase.from('users').delete().eq('username', testUsername);
  assert.strictEqual(deleteErr, null, 'Exclusão de usuário não deve dar erro');
  const { data: deletedCheck } = await supabase.from('users').select('id').eq('username', testUsername);
  assert.strictEqual(deletedCheck.length, 0, 'Usuário deve ter sido excluído com sucesso');
  console.log('✓ Teste 5.4: Usuário excluído do Supabase com sucesso.');

  console.log('\n🎉 TODOS OS TESTES DE INTEGRAÇÃO COM O SUPABASE PASSARAM COM 100% DE SUCESSO!\n');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes de integração com Supabase:', err);
  process.exit(1);
});
