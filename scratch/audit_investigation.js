const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

async function runAudit() {
  console.log('=== INICIANDO AUDITORIA EXAUSTIVA ===\n');

  // 1. Carregar Levantamento de Requisitos
  const levantamentoDir = 'C:\\Users\\usuario\\Documents\\Codex\\2026-09-16\\fa-a-um-web-scraping-do-3\\outputs\\Levantamento de Requisitos';
  const estruturadosPath = path.join(levantamentoDir, 'dados_estruturados.json');
  const auditoriaPath = path.join(levantamentoDir, 'auditoria_dados.json');
  const conferenciasPath = path.join(levantamentoDir, 'conferencia_extracao.json');

  let levantamentoProposals = [];
  if (fs.existsSync(estruturadosPath)) {
    const raw = JSON.parse(fs.readFileSync(estruturadosPath, 'utf8'));
    console.log('[dados_estruturados.json] Top keys:', Object.keys(raw));
    // Let's see what key has the proposals
    for (const k of Object.keys(raw)) {
      if (Array.isArray(raw[k])) {
        console.log(`Key ${k}: Array with length ${raw[k].length}`);
        if (raw[k].length > 500) {
          levantamentoProposals = raw[k];
        }
      }
    }
    console.log(`[Levantamento] Identificadas ${levantamentoProposals.length} propostas`);
  } else {
    console.warn(`[Levantamento] Não encontrado: ${estruturadosPath}`);
  }

  // 2. Carregar js/database.js
  const dbJsPath = path.join(__dirname, '..', 'js', 'database.js');
  const dbJsContent = fs.readFileSync(dbJsPath, 'utf8');
  const sandbox = {};
  eval(dbJsContent.replace(/window\./g, 'sandbox.'));
  const jsData = sandbox.CRM_INITIAL_DATA;
  const jsProposals = jsData.proposals || [];
  console.log(`[database.js] Carregadas ${jsProposals.length} propostas`);

  // 3. Carregar PostgreSQL public.proposals
  const pgClient = new Client({
    host: '127.0.0.1',
    port: 56322,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres'
  });
  await pgClient.connect();
  const pgRes = await pgClient.query('SELECT * FROM public.proposals ORDER BY id');
  const pgProposals = pgRes.rows;
  console.log(`[PostgreSQL] Carregadas ${pgProposals.length} propostas da tabela public.proposals`);

  // 4. Carregar via Supabase REST API
  const SUPABASE_URL = 'http://127.0.0.1:56321';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Consulta sem paginação (comportamento atual)
  const { data: apiDefault, count: apiCount } = await supabase
    .from('proposals')
    .select('*', { count: 'exact' })
    .order('id', { ascending: true });
  console.log(`[Supabase REST atual] Retornou ${apiDefault?.length} registros (total no banco: ${apiCount})`);

  // Consulta com paginação por range
  let apiAll = [];
  let page = 0;
  const pageSize = 500;
  let hasMore = true;
  while (hasMore) {
    const { data: pageData, error } = await supabase
      .from('proposals')
      .select('*')
      .order('id', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) {
      console.error('Erro na paginação REST:', error);
      break;
    }
    apiAll.push(...pageData);
    if (pageData.length < pageSize) {
      hasMore = false;
    } else {
      page++;
    }
  }
  console.log(`[Supabase REST com paginação] Retornou ${apiAll.length} registros`);

  // ==========================================
  // COMPARAÇÃO DE IDS E UNICIDADE
  // ==========================================
  console.log('\n--- Comparação de IDs ---');
  const levIds = new Set(levantamentoProposals.map(p => String(p.ID || p.id)));
  const jsIds = new Set(jsProposals.map(p => String(p.ID || p.id)));
  const pgIds = new Set(pgProposals.map(p => String(p.id)));
  const apiDefaultIds = new Set(apiDefault.map(p => String(p.id)));
  const apiAllIds = new Set(apiAll.map(p => String(p.id)));

  console.log(`Levantamento IDs únicos: ${levIds.size}`);
  console.log(`database.js IDs únicos: ${jsIds.size}`);
  console.log(`PostgreSQL IDs únicos: ${pgIds.size}`);
  console.log(`API REST sem paginação IDs únicos: ${apiDefaultIds.size}`);
  console.log(`API REST paginada IDs únicos: ${apiAllIds.size}`);

  // Verificar se há IDs duplicados em database.js ou lev
  const jsIdCounts = {};
  jsProposals.forEach(p => {
    const id = String(p.ID);
    jsIdCounts[id] = (jsIdCounts[id] || 0) + 1;
  });
  const jsDups = Object.entries(jsIdCounts).filter(([k, v]) => v > 1);
  console.log(`database.js IDs duplicados: ${jsDups.length}`);

  // Verificar diferença de IDs entre database.js e PostgreSQL
  const missingInPg = [...jsIds].filter(id => !pgIds.has(id));
  const extraInPg = [...pgIds].filter(id => !jsIds.has(id));
  console.log(`IDs em database.js mas fora do PG: ${missingInPg.length}`);
  console.log(`IDs no PG mas fora do database.js: ${extraInPg.length}`);

  // Os 72 IDs perdidos na API padrão (1.000 vs 1.072)
  const missingInApiDefault = [...pgIds].filter(id => !apiDefaultIds.has(id));
  console.log(`IDs ausentes no retorno da API padrão (1000 limit): ${missingInApiDefault.length}`);

  // ==========================================
  // FUNÇÕES NUMÉRICAS PT-BR
  // ==========================================
  function parsePtBrNumber(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    let s = String(val).trim().replace(/^R\$\s*/i, '').trim();
    if (!s) return 0;
    if (s.includes(',') && s.includes('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    } else if (s.includes('.')) {
      s = s.replace(/\./g, '');
    }
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
  }

  function parsePtBrLives(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val);
    let s = String(val).trim().replace(/\s/g, '');
    s = s.replace(/\./g, '').replace(',', '');
    const num = parseInt(s, 10);
    return isNaN(num) ? 0 : num;
  }

  // ==========================================
  // APURAÇÃO DE INDICADORES NO LOTE DE REFERÊNCIA (database.js)
  // ==========================================
  console.log('\n--- Apuração de Indicadores (js/database.js) ---');
  let totalVidasParseInt = 0;
  let totalVidasPtBr = 0;
  let totalFaturamentoPtBr = 0;
  let totalVidasFechadoParseInt = 0;
  let totalVidasFechadoPtBr = 0;
  let totalFaturamentoFechado = 0;
  let countFechado = 0;
  let countDesistencia = 0;
  let countDeclinado = 0;
  let statusCounts = {};
  let aptidaoCounts = {};
  let thousandSeparatorLives = [];

  for (const p of jsProposals) {
    const rawVidas = String(p.VIDAS || '0');
    if (rawVidas.includes('.')) {
      thousandSeparatorLives.push({ id: p.ID, vidas: rawVidas, parseInt: parseInt(rawVidas, 10), ptBr: parsePtBrLives(rawVidas) });
    }
    const vidasPI = parseInt(p.VIDAS, 10) || 0;
    const vidasReal = parsePtBrLives(p.VIDAS);
    const fatReal = parsePtBrNumber(p.FATURAMENTO);

    totalVidasParseInt += vidasPI;
    totalVidasPtBr += vidasReal;
    totalFaturamentoPtBr += fatReal;

    const status = (p.TEMPERATURA_CONTRATO || '').trim();
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const apt = (p.Aptidao || '').trim();
    aptidaoCounts[apt] = (aptidaoCounts[apt] || 0) + 1;

    if (status === 'Contrato Fechado') {
      countFechado++;
      totalVidasFechadoParseInt += vidasPI;
      totalVidasFechadoPtBr += vidasReal;
      totalFaturamentoFechado += fatReal;
    }
    if (status === 'Desistência da Empresa') {
      countDesistencia++;
    }
    if (status === 'Declinado pela SB Saúde') {
      countDeclinado++;
    }
  }

  console.log(`Propostas totais: ${jsProposals.length}`);
  console.log(`Vidas (com parseInt): ${totalVidasParseInt}`);
  console.log(`Vidas (com parsePtBr): ${totalVidasPtBr}`);
  console.log(`Propostas com ponto no campo VIDAS: ${thousandSeparatorLives.length}`);
  console.log(`Soma de vidas nessas 83 propostas (parseInt): ${thousandSeparatorLives.reduce((a, b) => a + b.parseInt, 0)}`);
  console.log(`Soma de vidas nessas 83 propostas (ptBr): ${thousandSeparatorLives.reduce((a, b) => a + b.ptBr, 0)}`);
  console.log(`Faturamento somado (parsePtBr): R$ ${totalFaturamentoPtBr.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`Contratos Fechados - Propostas: ${countFechado}`);
  console.log(`Contratos Fechados - Vidas (parseInt): ${totalVidasFechadoParseInt}`);
  console.log(`Contratos Fechados - Vidas (parsePtBr): ${totalVidasFechadoPtBr}`);
  console.log(`Contratos Fechados - Faturamento: R$ ${totalFaturamentoFechado.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`Conversão por proposta: ${(countFechado / jsProposals.length * 100).toFixed(1)}%`);
  console.log(`TKM ponderado: R$ ${(totalFaturamentoPtBr / totalVidasPtBr).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`TKM ponderado com parseInt vidas: R$ ${(totalFaturamentoPtBr / totalVidasParseInt).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  console.log('\nDistribuição de Status (database.js):', statusCounts);
  console.log('Distribuição de Aptidão (database.js):', aptidaoCounts);

  // ==========================================
  // APURAÇÃO NA TABELA POSTGRESQL ATUAL
  // ==========================================
  console.log('\n--- Apuração na Tabela PostgreSQL public.proposals atual ---');
  const pgStatusRes = await pgClient.query(`
    SELECT temperatura_contrato, COUNT(*) as count, SUM(vidas_num) as vidas, SUM(faturamento_num) as fat
    FROM public.proposals GROUP BY temperatura_contrato ORDER BY count DESC
  `);
  console.log('PostgreSQL por Status:', pgStatusRes.rows);

  const pgAptRes = await pgClient.query(`
    SELECT aptidao, COUNT(*) as count FROM public.proposals GROUP BY aptidao ORDER BY count DESC
  `);
  console.log('PostgreSQL por Aptidão:', pgAptRes.rows);

  const pgTotals = await pgClient.query(`
    SELECT COUNT(*) as total_proposals, SUM(vidas_num) as total_vidas, SUM(faturamento_num) as total_fat
    FROM public.proposals
  `);
  console.log('PostgreSQL Totais:', pgTotals.rows[0]);

  // ==========================================
  // AUDITORIA DOS 20 CASOS DE FATURAMENTO DIVERGENTE
  // ==========================================
  console.log('\n--- Análise dos 20 casos onde FATURAMENTO != VIDAS * TKM ---');
  let diffCases = [];
  for (const p of jsProposals) {
    const vidas = parsePtBrLives(p.VIDAS);
    const tkm = parsePtBrNumber(p.TKM);
    const fat = parsePtBrNumber(p.FATURAMENTO);
    const calc = Math.round(vidas * tkm * 100) / 100;
    const diff = Math.abs(fat - calc);
    if (diff > 0.01) {
      diffCases.push({
        id: p.ID,
        empresa: p.EMPRESA,
        vidas,
        tkm,
        faturamento_original: fat,
        faturamento_calculado: calc,
        diferenca: Math.round((fat - calc) * 100) / 100
      });
    }
  }
  console.log(`Casos com divergência > R$ 0,01: ${diffCases.length}`);
  console.log('Primeiros 5 casos divergentes:', diffCases.slice(0, 5));

  // Verificar como esses 20 casos estão em PostgreSQL (faturamento_num vs faturamento original)
  const diffIds = diffCases.map(c => `'${c.id}'`).join(',');
  if (diffIds) {
    const pgDiffCheck = await pgClient.query(`
      SELECT id, vidas_num, tkm_num, faturamento, faturamento_num FROM public.proposals WHERE id IN (${diffIds}) LIMIT 5
    `);
    console.log('PostgreSQL valores para os casos divergentes:', pgDiffCheck.rows);
  }

  // ==========================================
  // AUDITORIA DAS PENDÊNCIAS DO LEVANTAMENTO
  // ==========================================
  console.log('\n--- Auditoria das Pendências do Levantamento ---');
  // 1) 524 propostas com coparticipação sem política
  const copartSemPolitica = jsProposals.filter(p => 
    (p.FATOR_MODERADOR || '').includes('Coparticipação') && (!p.POLITICA_COPARTICIPACAO || p.POLITICA_COPARTICIPACAO.trim() === '')
  );
  console.log(`Propostas com coparticipação sem política: ${copartSemPolitica.length}`);

  // 2) Faixas etárias: 323 vazias, 422 com todas as 47 faixas
  const faixasVazias = jsProposals.filter(p => !p.Qnt_Faixa_Etaria || p.Qnt_Faixa_Etaria.trim() === '' || !p.Faixa_Etaria || p.Faixa_Etaria.trim() === '');
  console.log(`Propostas com faixas etárias vazias: ${faixasVazias.length}`);

  const faixas47 = jsProposals.filter(p => {
    const fe = p.Faixa_Etaria || '';
    return fe.split(',').length >= 40 || fe.length > 500;
  });
  console.log(`Propostas com todas/muitas faixas: ${faixas47.length}`);

  // 3) 51 cidades suspeitas
  // Ler auditoria_dados.json se disponível
  if (fs.existsSync(auditoriaPath)) {
    const auditJson = JSON.parse(fs.readFileSync(auditoriaPath, 'utf8'));
    console.log('[auditoria_dados.json] Chaves:', Object.keys(auditJson));
    if (auditJson.cidades_suspeitas || auditJson.cidades) {
      console.log('Cidades suspeitas no json de auditoria:', auditJson.cidades_suspeitas || auditJson.cidades);
    }
  }

  // 4) 24 sem campanha
  const semCampanha = jsProposals.filter(p => !p.PLANO_CAMPANHA || p.PLANO_CAMPANHA.trim() === '');
  console.log(`Propostas sem campanha: ${semCampanha.length}`);

  // 5) 1 declínio sem justificativa
  const declinioSemJust = jsProposals.filter(p => 
    (p.TEMPERATURA_CONTRATO === 'Declinado pela SB Saúde') && (!p.Motivo_Declinio || p.Motivo_Declinio.trim() === '')
  );
  console.log(`Declínio sem justificativa: ${declinioSemJust.length}`, declinioSemJust.map(p => ({ id: p.ID, empresa: p.EMPRESA, status: p.TEMPERATURA_CONTRATO, motivo: p.Motivo_Declinio })));

  // 6) 1 proposta sem usuário
  const semUsuario = jsProposals.filter(p => !p.Usuario || p.Usuario.trim() === '');
  console.log(`Proposta sem usuário: ${semUsuario.length}`, semUsuario.map(p => ({ id: p.ID, empresa: p.EMPRESA, user: p.Usuario })));

  // ==========================================
  // APURAÇÃO DOS PRIMEIROS 1.000 IDs (REPRODUZINDO A CAPTURA)
  // ==========================================
  console.log('\n--- Reprodução Exata da Captura com os Primeiros 1.000 IDs Ordenados Alfabeticamente ---');
  const sortedById = [...jsProposals].sort((a, b) => String(a.ID).localeCompare(String(b.ID)));
  const first1000 = sortedById.slice(0, 1000);

  let capStatusCounts = {};
  let capVidasParseInt = 0;
  let capVidasPtBr = 0;
  let capFat = 0;
  let capFatFechado = 0;
  let capVidasFechadoPI = 0;
  let capVidasFechadoPtBr = 0;
  let capFechado = 0;

  for (const p of first1000) {
    const st = (p.TEMPERATURA_CONTRATO || '').trim();
    capStatusCounts[st] = (capStatusCounts[st] || 0) + 1;
    const vPI = parseInt(p.VIDAS, 10) || 0;
    const vPtBr = parsePtBrLives(p.VIDAS);
    const f = parsePtBrNumber(p.FATURAMENTO);

    capVidasParseInt += vPI;
    capVidasPtBr += vPtBr;
    capFat += f;

    if (st === 'Contrato Fechado') {
      capFechado++;
      capFatFechado += f;
      capVidasFechadoPI += vPI;
      capVidasFechadoPtBr += vPtBr;
    }
  }

  console.log('Status nos primeiros 1.000 IDs:', capStatusCounts);
  console.log(`Vidas parseInt (captura): ${capVidasParseInt}`);
  console.log(`Vidas ptBr nos 1000: ${capVidasPtBr}`);
  console.log(`Faturamento total nos 1000: R$ ${capFat.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`Contrato Fechado nos 1000: ${capFechado} propostas, ${capVidasFechadoPI} vidas (parseInt), R$ ${capFatFechado.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`Conversão nos 1000: ${(capFechado / 1000 * 100).toFixed(1)}%`);
  console.log(`TKM ponderado na captura (fat / vidas parseInt): R$ ${(capFat / capVidasParseInt).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Casos úteis do prompt:
  // Região BA
  const baProposals = jsProposals.filter(p => (p.UF || '').trim() === 'BA');
  console.log(`\nRegião BA (total): ${baProposals.length} propostas; vidas ptBr = ${baProposals.reduce((a, b) => a + parsePtBrLives(b.VIDAS), 0)}; vidas parseInt = ${baProposals.reduce((a, b) => a + (parseInt(b.VIDAS, 10) || 0), 0)}`);
  const ba1000 = first1000.filter(p => (p.UF || '').trim() === 'BA');
  console.log(`Região BA (primeiros 1000): ${ba1000.length} propostas; vidas parseInt = ${ba1000.reduce((a, b) => a + (parseInt(b.VIDAS, 10) || 0), 0)}`);

  // Maior negociação: INSTITUTO DE PREVIDÊNCIA DE SANTO ANDRÉ
  const santoAndre = jsProposals.find(p => (p.EMPRESA || '').includes('SANTO ANDRÉ'));
  console.log('\nSanto André na base completa:', santoAndre ? {
    id: santoAndre.ID,
    empresa: santoAndre.EMPRESA,
    vidasRaw: santoAndre.VIDAS,
    vidasParseInt: parseInt(santoAndre.VIDAS, 10),
    vidasPtBr: parsePtBrLives(santoAndre.VIDAS),
    faturamento: santoAndre.FATURAMENTO
  } : 'Não encontrado');

  // Corretor líder: Via Cadastro
  const viaCadastro = jsProposals.filter(p => (p.CORRETORES_1 || '').includes('Via Cadastro'));
  console.log('\nVia Cadastro na base completa:', {
    propostas: viaCadastro.length,
    faturamento: viaCadastro.reduce((a, b) => a + parsePtBrNumber(b.FATURAMENTO), 0)
  });

  await pgClient.end();
  console.log('\n=== AUDITORIA CONCLUÍDA ===');
}

runAudit().catch(err => {
  console.error('Erro na auditoria:', err);
  process.exit(1);
});
