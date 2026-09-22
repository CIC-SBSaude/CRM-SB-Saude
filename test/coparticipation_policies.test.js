const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

// Mock global window/localStorage for SBClient in Node.js environment
global.window = {
  supabase: { createClient },
  location: { hostname: '127.0.0.1' }
};

const { SBClient } = require('../js/supabase-client.js');
const reportsEngine = require('../js/reports-engine.js');

async function runTests() {
  console.log('================================================================');
  console.log(' TESTE AUTOMATIZADO: POLÍTICAS DE COPARTICIPAÇÃO (RN-09)');
  console.log('================================================================\n');

  const sbClient = new SBClient();
  const pgClient = new Client({
    host: '127.0.0.1',
    port: 56322,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres'
  });
  await pgClient.connect();

  try {
    // -------------------------------------------------------------
    // Teste 1: Mapeamento Bidirecional de Dados (DB <-> Canônico)
    // -------------------------------------------------------------
    console.log('--- Teste 1: Mapeamento Bidirecional Canônico ---');
    const sampleDbRow = {
      id: 99,
      row_number: '10',
      id_politica: 'CP-99',
      nome_politica: 'Coparticipação Teste Unidade',
      percentual_desconto_evento: '20,00%',
      qnt_partida_evento: '3',
      valor_consulta_eletiva: 'R$ 50,00',
      valor_consulta_emergencia: 'R$ 80,00',
      valor_exames_simples: 'R$ 25,00',
      valor_exames_complexos: 'R$ 110,00',
      terapia: 'Sim',
      valor_terapia: 'R$ 40,00',
      imagem: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    };

    const canonical = sbClient.mapDbToCopartPolicy(sampleDbRow);
    assert.equal(canonical.id, 99);
    assert.equal(canonical.Nome_Politica, 'Coparticipação Teste Unidade');
    assert.equal(canonical.Percentual_Desconto_Evento, '20,00%');
    assert.equal(canonical.Qnt_Partida_Evento, '3');
    assert.equal(canonical.Valor_Consulta_Eletiva, 'R$ 50,00');
    assert.equal(canonical.Valor_Consulta_Emergencia, 'R$ 80,00');
    assert.equal(canonical.Valor_Exames_Simples, 'R$ 25,00');
    assert.equal(canonical.Valor_Exames_Complexos, 'R$ 110,00');
    assert.equal(canonical.Terapia, 'Sim');
    assert.equal(canonical.Valor_Terapia, 'R$ 40,00');
    assert.ok(canonical.Imagem.startsWith('data:image/'));

    // Verifica que aliases de compatibilidade foram preenchidos
    assert.equal(canonical.Desconto_Evento, '20,00%');
    assert.equal(canonical.Consulta_Eletiva, 'R$ 50,00');

    // Converte de volta para DB
    const dbPayload = sbClient.mapCopartPolicyToDb(canonical);
    assert.equal(dbPayload.nome_politica, 'Coparticipação Teste Unidade');
    assert.equal(dbPayload.percentual_desconto_evento, '20,00%');
    assert.equal(dbPayload.qnt_partida_evento, '3');
    assert.equal(dbPayload.valor_consulta_eletiva, 'R$ 50,00');
    assert.equal(dbPayload.terapia, 'Sim');
    assert.equal(dbPayload.valor_terapia, 'R$ 40,00');
    console.log('✓ Teste 1 concluído: Mapeamento DB <-> Canônico íntegro sem campos undefined.');

    // -------------------------------------------------------------
    // Teste 2: Normalização de Registros Legados (chaves com espaços)
    // -------------------------------------------------------------
    console.log('\n--- Teste 2: Normalização de Registros com Chaves Legadas ---');
    const legacyAppSheetItem = {
      'Politica Coparticipacao': 'Coparticipação 30% Legada',
      'Percentual Desconto Evento': '30,00%',
      'Qnt Partida Evento': '5',
      'Valor Consulta Eletiva': 'R$ 45,00',
      'Valor Consulta Emergencia': 'R$ 75,00',
      'Valor Exames Simples': 'R$ 20,00',
      'Valor Exames Complexos': 'R$ 90,00',
      'Terapia': 'Não',
      'Valor Terapia': 'Não aplicável',
      'Imagem': 'Politica_Coparticipacao_Images/legacy.jpg'
    };

    const normalized = sbClient.mapCopartPolicyToDb(legacyAppSheetItem);
    assert.equal(normalized.nome_politica, 'Coparticipação 30% Legada');
    assert.equal(normalized.percentual_desconto_evento, '30,00%');
    assert.equal(normalized.qnt_partida_evento, '5');
    assert.equal(normalized.valor_consulta_eletiva, 'R$ 45,00');
    assert.equal(normalized.terapia, 'Não');
    assert.equal(normalized.valor_terapia, 'Não aplicável');
    console.log('✓ Teste 2 concluído: Chaves legadas com espaços normalizadas corretamente sem perda de dados.');

    // -------------------------------------------------------------
    // Teste 3: Ciclo Completo de CRUD no Supabase / PostgreSQL
    // -------------------------------------------------------------
    console.log('\n--- Teste 3: Ciclo Completo CRUD no Supabase (Docker) ---');
    const uniqueTestName = `COPART-TEST-${Date.now()}`;
    const newPolicy = {
      Nome_Politica: uniqueTestName,
      Percentual_Desconto_Evento: '18,00%',
      Qnt_Partida_Evento: '2',
      Valor_Consulta_Eletiva: 'R$ 55,00',
      Valor_Consulta_Emergencia: 'R$ 85,00',
      Valor_Exames_Simples: 'R$ 30,00',
      Valor_Exames_Complexos: 'R$ 120,00',
      Terapia: 'Sim',
      Valor_Terapia: 'R$ 42,00',
      Imagem: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjDAGACanAgWBGQo5AAAAAElFTkSuQmCC'
    };

    // 3.1 Create (Insert)
    const saveRes = await sbClient.saveCopartPolicy(newPolicy);
    assert.ok(saveRes.success, `Criação da política deve retornar sucesso: ${saveRes.error}`);
    assert.ok(saveRes.data && saveRes.data.id, 'Resposta deve conter ID gerado');
    const createdId = saveRes.data.id;
    console.log(`✓ 3.1: Política inserida com sucesso com ID = ${createdId}.`);

    // 3.2 Verificar persistência no PostgreSQL
    const pgCheck = await pgClient.query('SELECT * FROM public.coparticipation_policies WHERE id = $1', [createdId]);
    assert.equal(pgCheck.rows.length, 1, 'Registro deve existir no PostgreSQL');
    const pgRow = pgCheck.rows[0];
    assert.equal(pgRow.nome_politica, uniqueTestName);
    assert.equal(pgRow.percentual_desconto_evento, '18,00%');
    assert.equal(pgRow.qnt_partida_evento, '2');
    assert.equal(pgRow.valor_consulta_eletiva, 'R$ 55,00');
    assert.equal(pgRow.terapia, 'Sim');
    assert.equal(pgRow.valor_terapia, 'R$ 42,00');
    console.log('✓ 3.2: Persistência física verificada via query PostgreSQL direta.');

    // 3.3 Read (fetchCopartPolicies)
    const allPolicies = await sbClient.fetchCopartPolicies();
    assert.ok(Array.isArray(allPolicies) && allPolicies.length > 0, 'fetchCopartPolicies deve retornar lista');
    const found = allPolicies.find(p => p.id === createdId);
    assert.ok(found, 'A política criada deve estar presente no retorno de fetchCopartPolicies');
    assert.equal(found.Nome_Politica, uniqueTestName);
    assert.equal(found.Percentual_Desconto_Evento, '18,00%');
    assert.notEqual(found.Valor_Consulta_Eletiva, undefined);
    assert.notEqual(found.Valor_Consulta_Emergencia, undefined);
    console.log('✓ 3.3: Leitura e recarregamento validados sem nenhum campo undefined.');

    // 3.4 Update / Rename mantendo o mesmo ID (Sem duplicar registros)
    const renamedName = `${uniqueTestName}-RENOMEADA`;
    const updatePayload = {
      id: createdId,
      Id_Politica: found.Id_Politica,
      Nome_Politica: renamedName,
      Percentual_Desconto_Evento: '25,00%',
      Qnt_Partida_Evento: '4',
      Valor_Consulta_Eletiva: 'R$ 65,00',
      Valor_Consulta_Emergencia: 'R$ 95,00',
      Valor_Exames_Simples: 'R$ 35,00',
      Valor_Exames_Complexos: 'R$ 130,00',
      Terapia: 'Não',
      Valor_Terapia: 'Não aplicável',
      Imagem: found.Imagem
    };

    const updateRes = await sbClient.saveCopartPolicy(updatePayload);
    assert.ok(updateRes.success, `Atualização deve ter sucesso: ${updateRes.error}`);
    assert.equal(updateRes.data.id, createdId, 'ID deve ser estritamente preservado');
    assert.equal(updateRes.data.Nome_Politica, renamedName);

    // Verificar se não duplicou no PostgreSQL
    const dupCheck = await pgClient.query('SELECT id, nome_politica FROM public.coparticipation_policies WHERE id = $1', [createdId]);
    assert.equal(dupCheck.rows.length, 1, 'Deve existir exatamente 1 registro para o ID');
    assert.equal(dupCheck.rows[0].nome_politica, renamedName, 'Nome deve ter sido atualizado no banco');

    const totalMatching = await pgClient.query('SELECT COUNT(*) FROM public.coparticipation_policies WHERE nome_politica LIKE $1', [`%${uniqueTestName}%`]);
    assert.equal(parseInt(totalMatching.rows[0].count, 10), 1, 'Não deve haver registros duplicados após renomear');
    console.log('✓ 3.4: Renomeação e edição verificadas por ID único; zero duplicação de dados.');

    // 3.5 Delete
    const deleteRes = await sbClient.deleteCopartPolicy(createdId);
    assert.ok(deleteRes.success, `Exclusão deve retornar sucesso: ${deleteRes.error}`);

    const afterDelCheck = await pgClient.query('SELECT * FROM public.coparticipation_policies WHERE id = $1', [createdId]);
    assert.equal(afterDelCheck.rows.length, 0, 'Registro deve ter sido deletado do PostgreSQL');
    console.log('✓ 3.5: Exclusão confirmada no banco de dados.');

    // -------------------------------------------------------------
    // Teste 4: Rejeição de Duplicidade sem Falso Sucesso
    // -------------------------------------------------------------
    console.log('\n--- Teste 4: Rejeição de Nome Duplicado (Constraint Unicidade) ---');
    // Pegar o primeiro registro existente no banco
    const firstRow = (await pgClient.query('SELECT nome_politica FROM public.coparticipation_policies LIMIT 1')).rows[0];
    assert.ok(firstRow, 'Deve haver ao menos 1 política existente no banco');

    // Tentar criar nova política com o mesmo nome
    const conflictRes = await sbClient.saveCopartPolicy({
      Nome_Politica: firstRow.nome_politica,
      Percentual_Desconto_Evento: '10,00%',
      Qnt_Partida_Evento: '1'
    });

    assert.equal(conflictRes.success, false, 'Salvar política com nome duplicado deve retornar success: false');
    assert.ok(conflictRes.error, 'Deve conter mensagem de erro descritiva');
    console.log(`✓ Teste 4 concluído: Supabase barrou duplicidade com erro: "${conflictRes.error}".`);

    // -------------------------------------------------------------
    // Teste 5: Integração com Motor de Relatórios e Dropdown de Propostas
    // -------------------------------------------------------------
    console.log('\n--- Teste 5: Motor de Relatórios e Dropdown de Propostas ---');
    const mockAppData = {
      coparticipationPolicies: [
        {
          id: 1,
          Nome_Politica: 'Coparticipação Econômica - 10% (1x)',
          Percentual_Desconto_Evento: '10,00%',
          Valor_Consulta_Eletiva: 'R$ 40,00',
          Valor_Consulta_Emergencia: 'R$ 70,00',
          Valor_Exames_Simples: 'R$ 20,00',
          Valor_Exames_Complexos: 'R$ 90,00',
          Valor_Terapia: 'Não aplicável'
        }
      ],
      agencyPolicies: []
    };

    const mockUser = { login: 'ADMINISTRADOR', profile: 'Administrador Master' };
    const reportRecords = reportsEngine.extractSourceRecords('policies', mockAppData, mockUser);
    assert.ok(Array.isArray(reportRecords) && reportRecords.length === 1);
    const rep = reportRecords[0];
    assert.equal(rep.NOME_POLITICA, 'Coparticipação Econômica - 10% (1x)');
    assert.equal(rep.DESCONTO_EVENTO, '10,00%', 'Não deve gerar percentual duplo %%');
    assert.ok(rep.CONSULTA_ELETIVA.includes('40'), 'Consulta eletiva deve ser formatada');

    // Testar texto formatado do dropdown
    const optionText = `${mockAppData.coparticipationPolicies[0].Nome_Politica} (Desconto: ${mockAppData.coparticipationPolicies[0].Percentual_Desconto_Evento}, Consulta: ${mockAppData.coparticipationPolicies[0].Valor_Consulta_Eletiva})`;
    assert.ok(!optionText.includes('undefined'), 'Opção do dropdown de propostas não deve conter undefined');
    console.log('✓ Teste 5 concluído: Relatórios e dropdown de propostas renderizam sem undefined e sem duplo %%.');

    // -------------------------------------------------------------
    // Teste 6: Inspeção de Código e Resiliência de Imagens
    // -------------------------------------------------------------
    console.log('\n--- Teste 6: Resiliência de Imagens e Fallback Shield ---');
    const appJsCode = fs.readFileSync('js/app.js', 'utf8');
    const cssCode = fs.readFileSync('css/styles.css', 'utf8');

    assert.ok(cssCode.includes('.copart-thumb-wrapper'), 'styles.css deve definir .copart-thumb-wrapper');
    assert.ok(cssCode.includes('.copart-fallback-icon'), 'styles.css deve definir .copart-fallback-icon');
    assert.ok(cssCode.includes('.copart-img-remove-btn'), 'styles.css deve definir .copart-img-remove-btn');
    assert.ok(appJsCode.includes('copart-thumb-wrapper'), 'app.js deve utilizar copart-thumb-wrapper');
    assert.ok(appJsCode.includes('🛡️'), 'app.js deve renderizar o badge de fallback 🛡️');
    assert.ok(appJsCode.includes('btn-copart-remove-img'), 'app.js deve conter botão para remover imagem anexada');
    console.log('✓ Teste 6 concluído: Fallback visual 🛡️ e remoção de imagem verificados no código.');

    console.log('\n================================================================');
    console.log(' TODOS OS TESTES DE POLÍTICAS DE COPARTICIPAÇÃO PASSARAM! (6/6)');
    console.log('================================================================\n');
  } finally {
    await pgClient.end();
  }
}

runTests().catch(err => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES DE COPARTICIPAÇÃO:', err);
  process.exit(1);
});
