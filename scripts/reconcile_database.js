const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const BusinessRules = require('../js/business-rules.js');

async function reconcile() {
  console.log('--- Iniciando Reconciliação Idempotente do Banco PostgreSQL (127.0.0.1:56322) ---\n');

  const client = new Client({
    host: '127.0.0.1',
    port: 56322,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres'
  });
  await client.connect();
  console.log('✓ Conectado ao PostgreSQL.');

  // 1. Atualizar Função do Trigger de Faturamento e Aptidão (RN-03 e RN-05)
  console.log('1. Atualizando trigger sync_proposal_financials()...');
  await client.query(`
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
  `);
  console.log('✓ Trigger sync_proposal_financials() atualizado com sucesso.');

  // 2. Reconciliar Aptidão para Desistência da Empresa (RN-05)
  console.log('\n2. Reconciliando coluna aptidao das propostas...');
  const desBefore = await client.query(`
    SELECT COUNT(*) FROM public.proposals WHERE temperatura_contrato = 'Desistência da Empresa' AND aptidao = 'Inapto'
  `);
  const affectedDesCount = parseInt(desBefore.rows[0].count, 10);
  console.log(`Propostas de "Desistência da Empresa" atualmente marcadas como Inapto: ${affectedDesCount}`);

  if (affectedDesCount > 0) {
    const updateRes = await client.query(`
      UPDATE public.proposals
      SET aptidao = 'Apto'
      WHERE temperatura_contrato = 'Desistência da Empresa' AND aptidao = 'Inapto'
    `);
    console.log(`✓ Atualizadas ${updateRes.rowCount} propostas de "Desistência da Empresa" para aptidao = 'Apto'.`);
  } else {
    console.log('✓ Nenhuma proposta de Desistência da Empresa necessita correção de aptidão.');
  }

  // 3. Reconciliar faturamento_num com base no faturamento histórico (20 casos de divergência)
  console.log('\n3. Auditando e reconciliando faturamento_num com o faturamento histórico original...');
  const allProposals = await client.query(`SELECT id, vidas, vidas_num, tkm, tkm_num, faturamento, faturamento_num FROM public.proposals ORDER BY id`);
  let updatedFatCount = 0;
  const fatDiffLog = [];

  for (const row of allProposals.rows) {
    const origFat = BusinessRules.parseCurrency(row.faturamento);
    const currFatNum = parseFloat(row.faturamento_num);
    const diff = Math.abs(origFat - currFatNum);

    if (diff > 0.005) {
      fatDiffLog.push({
        id: row.id,
        faturamento_texto: row.faturamento,
        faturamento_num_anterior: currFatNum,
        faturamento_num_corrigido: origFat,
        diff: Math.round((origFat - currFatNum) * 100) / 100
      });

      await client.query(`
        UPDATE public.proposals
        SET faturamento_num = $1
        WHERE id = $2
      `, [origFat, row.id]);
      updatedFatCount++;
    }
  }

  console.log(`✓ Reconciliados ${updatedFatCount} registros onde faturamento_num divergia do faturamento histórico.`);
  if (fatDiffLog.length > 0) {
    console.log('Exemplos de correção de faturamento_num:', fatDiffLog.slice(0, 5));
  }

  // 4. Verificação Final de Integridade no Banco
  console.log('\n4. Verificação de integridade pós-reconciliação:');
  const totals = await client.query(`
    SELECT
      COUNT(*) AS total_props,
      SUM(vidas_num) AS total_vidas,
      SUM(faturamento_num) AS total_fat,
      COUNT(CASE WHEN aptidao = 'Apto' THEN 1 END) AS total_apto,
      COUNT(CASE WHEN aptidao = 'Inapto' THEN 1 END) AS total_inapto
    FROM public.proposals
  `);
  const t = totals.rows[0];
  console.log(`- Total de Propostas: ${t.total_props} (esperado: 1072)`);
  console.log(`- Total de Vidas: ${t.total_vidas} (esperado: 477543)`);
  console.log(`- Faturamento Total: R$ ${parseFloat(t.total_fat).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (esperado: R$ 100.167.303,43)`);
  console.log(`- Aptos: ${t.total_apto} (esperado: 955)`);
  console.log(`- Inaptos: ${t.total_inapto} (esperado: 117)`);

  const closed = await client.query(`
    SELECT
      COUNT(*) AS count,
      SUM(vidas_num) AS vidas,
      SUM(faturamento_num) AS fat
    FROM public.proposals
    WHERE temperatura_contrato = 'Contrato Fechado'
  `);
  const c = closed.rows[0];
  console.log(`- Contratos Fechados: ${c.count} propostas (esperado: 194), ${c.vidas} vidas (esperado: 24770), R$ ${parseFloat(c.fat).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (esperado: R$ 3.173.398,87)`);

  await client.end();
  console.log('\n=== RECONCILIAÇÃO DO BANCO CONCLUÍDA COM SUCESSO! ===\n');
}

reconcile().catch(err => {
  console.error('Erro na reconciliação do banco:', err);
  process.exit(1);
});
