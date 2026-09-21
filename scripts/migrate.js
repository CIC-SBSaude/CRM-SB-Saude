const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function migrate() {
  console.log('--- Iniciando Conexão e Migração com Supabase Docker (127.0.0.1:56322) ---');

  const client = new Client({
    host: '127.0.0.1',
    port: 56322,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres'
  });

  await client.connect();
  console.log('✓ Conectado ao banco de dados PostgreSQL com sucesso.');

  // 1. Executar Schema DDL
  await client.query('DROP TABLE IF EXISTS public.proposals CASCADE;');
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  console.log('Aplicando schema DDL (tabelas, triggers, RLS)...');
  await client.query(schemaSql);
  console.log('✓ Schema DDL aplicado com sucesso.');

  // 2. Carregar dados iniciais de js/database.js
  const dbJsContent = fs.readFileSync(path.join(__dirname, '..', 'js', 'database.js'), 'utf8');
  const windowObj = {};
  eval(dbJsContent.replace(/window\./g, 'windowObj.'));
  const data = windowObj.CRM_INITIAL_DATA;

  if (!data) {
    throw new Error('Falha ao carregar CRM_INITIAL_DATA de js/database.js');
  }

  console.log(`Carregados ${data.proposals.length} propostas, ${data.companies.length} empresas, ${data.brokers.length} corretores.`);

  // 3. Inserir UFs
  console.log('Inserindo Estados (UFs)...');
  const ufsList = [
    { uf: 'AC', nome: 'Acre', regiao: 'Norte' },
    { uf: 'AL', nome: 'Alagoas', regiao: 'Nordeste' },
    { uf: 'AP', nome: 'Amapá', regiao: 'Norte' },
    { uf: 'AM', nome: 'Amazonas', regiao: 'Norte' },
    { uf: 'BA', nome: 'Bahia', regiao: 'Nordeste' },
    { uf: 'CE', nome: 'Ceará', regiao: 'Nordeste' },
    { uf: 'DF', nome: 'Distrito Federal', regiao: 'Centro-Oeste' },
    { uf: 'ES', nome: 'Espírito Santo', regiao: 'Sudeste' },
    { uf: 'GO', nome: 'Goiás', regiao: 'Centro-Oeste' },
    { uf: 'MA', nome: 'Maranhão', regiao: 'Nordeste' },
    { uf: 'MT', nome: 'Mato Grosso', regiao: 'Centro-Oeste' },
    { uf: 'MS', nome: 'Mato Grosso do Sul', regiao: 'Centro-Oeste' },
    { uf: 'MG', nome: 'Minas Gerais', regiao: 'Sudeste' },
    { uf: 'PA', nome: 'Pará', regiao: 'Norte' },
    { uf: 'PB', nome: 'Paraíba', regiao: 'Nordeste' },
    { uf: 'PR', nome: 'Paraná', regiao: 'Sul' },
    { uf: 'PE', nome: 'Pernambuco', regiao: 'Nordeste' },
    { uf: 'PI', nome: 'Piauí', regiao: 'Nordeste' },
    { uf: 'RJ', nome: 'Rio de Janeiro', regiao: 'Sudeste' },
    { uf: 'RN', nome: 'Rio Grande do Norte', regiao: 'Nordeste' },
    { uf: 'RS', nome: 'Rio Grande do Sul', regiao: 'Sul' },
    { uf: 'RO', nome: 'Rondônia', regiao: 'Norte' },
    { uf: 'RR', nome: 'Roraima', regiao: 'Norte' },
    { uf: 'SC', nome: 'Santa Catarina', regiao: 'Sul' },
    { uf: 'SP', nome: 'São Paulo', regiao: 'Sudeste' },
    { uf: 'SE', nome: 'Sergipe', regiao: 'Nordeste' },
    { uf: 'TO', nome: 'Tocantins', regiao: 'Norte' }
  ];

  for (const u of ufsList) {
    await client.query(
      `INSERT INTO public.ufs (uf, nome, regiao) VALUES ($1, $2, $3)
       ON CONFLICT (uf) DO UPDATE SET nome = EXCLUDED.nome, regiao = EXCLUDED.regiao`,
      [u.uf, u.nome, u.regiao]
    );
  }
  console.log(`✓ 27 UFs cadastradas.`);

  // 4. Inserir Empresas
  console.log('Migrando empresas...');
  let compCount = 0;
  for (const c of data.companies) {
    if (!c.EMPRESA) continue;
    await client.query(
      `INSERT INTO public.companies (row_number, empresa, logo, uf)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (empresa) DO UPDATE SET logo = EXCLUDED.logo`,
      [parseInt(c._RowNumber, 10) || null, c.EMPRESA.trim(), c.LOGO || null, 'BA']
    );
    compCount++;
  }
  console.log(`✓ ${compCount} empresas inseridas/atualizadas.`);

  // 5. Inserir Corretores
  console.log('Migrando corretores...');
  let brokerCount = 0;
  for (const b of data.brokers) {
    if (!b.CORRETOR_1) continue;
    await client.query(
      `INSERT INTO public.brokers (row_number, corretor_1, imagem)
       VALUES ($1, $2, $3)
       ON CONFLICT (corretor_1) DO UPDATE SET imagem = EXCLUDED.imagem`,
      [parseInt(b._RowNumber, 10) || null, b.CORRETOR_1.trim(), b.Imagem || null]
    );
    brokerCount++;
  }
  console.log(`✓ ${brokerCount} corretores inseridos/atualizados.`);

  // 6. Inserir Políticas de Agenciamento
  console.log('Migrando políticas de agenciamento...');
  for (const a of data.agencyPolicies) {
    if (!a.Politica_Agencimento) continue;
    await client.query(
      `INSERT INTO public.agency_policies (row_number, politica_agenciamento, agenciamento, vitalicio, parcelas)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (politica_agenciamento) DO UPDATE SET
         agenciamento = EXCLUDED.agenciamento,
         vitalicio = EXCLUDED.vitalicio,
         parcelas = EXCLUDED.parcelas`,
      [
        parseInt(a._RowNumber, 10) || null,
        a.Politica_Agencimento.trim(),
        a.Agenciamento || null,
        a.Vitalicio || null,
        a.Parcelas || null
      ]
    );
  }
  console.log('✓ Políticas de agenciamento cadastradas.');

  // 7. Inserir Políticas de Coparticipação
  console.log('Migrando políticas de coparticipação...');
  for (const cp of data.coparticipationPolicies) {
    if (!cp.Nome_Politica) continue;
    await client.query(
      `INSERT INTO public.coparticipation_policies (
         row_number, id_politica, nome_politica, percentual_desconto_evento, qnt_partida_evento,
         valor_consulta_eletiva, valor_consulta_emergencia, valor_exames_simples, valor_exames_complexos,
         valor_terapia, imagem, terapia
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (nome_politica) DO UPDATE SET
         percentual_desconto_evento = EXCLUDED.percentual_desconto_evento,
         qnt_partida_evento = EXCLUDED.qnt_partida_evento,
         valor_consulta_eletiva = EXCLUDED.valor_consulta_eletiva,
         valor_consulta_emergencia = EXCLUDED.valor_consulta_emergencia,
         valor_exames_simples = EXCLUDED.valor_exames_simples,
         valor_exames_complexos = EXCLUDED.valor_exames_complexos,
         valor_terapia = EXCLUDED.valor_terapia,
         terapia = EXCLUDED.terapia`,
      [
        parseInt(cp._RowNumber, 10) || null,
        cp.Id_Politica || null,
        cp.Nome_Politica.trim(),
        cp.Percentual_Desconto_Evento || null,
        cp.Qnt_Partida_Evento || null,
        cp.Valor_Consulta_Eletiva || null,
        cp.Valor_Consulta_Emergencia || null,
        cp.Valor_Exames_Simples || null,
        cp.Valor_Exames_Complexos || null,
        cp.Valor_Terapia || null,
        cp.Imagem || null,
        cp.Terapia || null
      ]
    );
  }
  console.log('✓ Políticas de coparticipação cadastradas.');

  // 8. Inserir Campanhas
  console.log('Migrando campanhas comerciais...');
  let campCount = 0;
  for (const cmp of data.campaignsList) {
    if (!cmp.name) continue;
    let year = 2024;
    if (cmp.name.includes('2026')) year = 2026;
    else if (cmp.name.includes('2025')) year = 2025;

    await client.query(
      `INSERT INTO public.campaigns (name, status, year, count, competencias)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO UPDATE SET
         status = EXCLUDED.status,
         year = EXCLUDED.year,
         count = EXCLUDED.count,
         competencias = EXCLUDED.competencias`,
      [
        cmp.name.trim(),
        cmp.name.includes('2026') ? 'Campanha Ativa' : 'Campanha Encerrada',
        year,
        cmp.count || 0,
        cmp.competencias || []
      ]
    );
    campCount++;
  }
  console.log(`✓ ${campCount} campanhas cadastradas.`);

  // 9. Inserir Usuários
  console.log('Migrando usuários e governança...');
  const defaultAdminUsers = [
    {
      id: 'USR-001',
      login: 'LUCAS',
      name: 'Lucas Santana',
      email: 'lucas.santana@sbsaude.com.br',
      role: 'Supervisor Comercial',
      profile: 'Supervisor Comercial',
      status: 'Ativo',
      password: 'SbSaude@2026',
      twoFactor: true,
      lastLogin: '17/09/2026 11:24',
      ip: '192.168.10.45',
      avatar: 'LU'
    },
    {
      id: 'USR-002',
      login: 'EDUARDO',
      name: 'Eduardo Guimarães',
      email: 'eduardo.guimaraes@sbsaude.com.br',
      role: 'Gerente Comercial',
      profile: 'Gestor Comercial',
      status: 'Ativo',
      password: 'SbSaude@2026',
      twoFactor: true,
      lastLogin: '17/09/2026 10:15',
      ip: '192.168.10.12',
      avatar: 'ED'
    },
    {
      id: 'USR-003',
      login: 'JULIA',
      name: 'Julia Medeiros',
      email: 'julia.medeiros@sbsaude.com.br',
      role: 'Analista Comercial',
      profile: 'Analista de Operações',
      status: 'Ativo',
      password: 'SbSaude@2026',
      twoFactor: true,
      lastLogin: '17/09/2026 09:40',
      ip: '192.168.10.18',
      avatar: 'JU'
    }
  ];

  for (const u of defaultAdminUsers) {
    await client.query(
      `INSERT INTO public.users (
         user_code, username, name, email, role, profile, status, password_hash, two_factor, last_login, ip, avatar
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (username) DO UPDATE SET
         user_code = EXCLUDED.user_code,
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         profile = EXCLUDED.profile,
         status = EXCLUDED.status,
         password_hash = EXCLUDED.password_hash,
         two_factor = EXCLUDED.two_factor,
         last_login = EXCLUDED.last_login,
         ip = EXCLUDED.ip,
         avatar = EXCLUDED.avatar,
         updated_at = NOW()`,
      [
        u.id,
        u.login.trim().toUpperCase(),
        u.name,
        u.email,
        u.role,
        u.profile,
        u.status,
        u.password,
        u.twoFactor,
        u.lastLogin,
        u.ip,
        u.avatar
      ]
    );
  }

  for (const u of data.users) {
    if (!u.User) continue;
    const username = u.User.trim().toUpperCase();
    await client.query(
      `INSERT INTO public.users (row_number, username, password_hash, role, profile)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO NOTHING`,
      [
        parseInt(u._RowNumber, 10) || null,
        username,
        u.Senha || 'SbSaude@2026',
        'Analista Comercial',
        'Administrador Master'
      ]
    );
  }
  console.log('✓ Usuários cadastrados.');

  // 10. Inserir Requisitos de Auditoria
  console.log('Migrando matriz de requisitos...');
  for (const r of data.requirementsList) {
    if (!r.id) continue;
    await client.query(
      `INSERT INTO public.system_requirements (id, module, priority, origin, title, behavior, acceptance)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         behavior = EXCLUDED.behavior,
         acceptance = EXCLUDED.acceptance`,
      [r.id, r.module, r.priority, r.origin, r.title, r.behavior, r.acceptance]
    );
  }
  console.log(`✓ ${data.requirementsList.length} requisitos de sistema cadastrados.`);

  // 11. Mapeamento de IDs de Empresas para Foreign Keys
  const companiesRes = await client.query('SELECT id, empresa FROM public.companies;');
  const companyMap = new Map();
  companiesRes.rows.forEach(r => companyMap.set(r.empresa.trim().toLowerCase(), r.id));

  // 12. Inserir Propostas (1072 registros)
  console.log('Migrando 1072 propostas completas com integridade referencial...');
  await client.query('BEGIN;');

  // Função auxiliar de conversão numérica
  const parseNum = (v) => {
    if (!v) return 0;
    const clean = String(v).replace('R$', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    return parseFloat(clean) || 0;
  };

  const parseLives = (v) => {
    if (!v) return 0;
    const clean = String(v).replace(/\./g, '').replace(',', '');
    return parseInt(clean, 10) || 0;
  };

  let propCount = 0;
  for (const p of data.proposals) {
    const empresaNorm = (p.EMPRESA || '').trim().toLowerCase();
    const empresaId = companyMap.get(empresaNorm) || null;
    const vidasNum = parseLives(p.VIDAS);
    const tkmNum = parseNum(p.TKM);
    const fatNum = parseNum(p.FATURAMENTO) || (vidasNum * tkmNum);

    await client.query(
      `INSERT INTO public.proposals (
         id, row_number, codigo_proposta, data_da_prospeccao, empresa, empresa_id,
         cnpj, competencia, vidas, vidas_num, cidade, uf, tkm, tkm_num,
         faturamento, faturamento_num, acomodacao, fator_moderador,
         politica_coparticipacao, corretores_1, agenciamento_1, vitalicio_1,
         corretores_2, agenciamento_2, vitalicio_2, corretores_3, agenciamento_3, vitalicio_3,
         plano_campanha, status_campanha, temperatura_contrato, aptidao, usuario,
         data_inclusao, hora_inclusao, tipo_contrato, qnt_faixa_etaria, faixa_etaria,
         data_analise_tecnica, data_avaliacao_diretoria, data_envio_corretor,
         motivo_declinio, observacao, conversao_solus, status_contrato, plataforma
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
         $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41,
         $42, $43, $44, $45, $46
       )
       ON CONFLICT (id) DO UPDATE SET
         empresa = EXCLUDED.empresa,
         faturamento = EXCLUDED.faturamento,
         temperatura_contrato = EXCLUDED.temperatura_contrato,
         updated_at = NOW();`,
      [
        String(p.ID),
        parseInt(p._RowNumber, 10) || null,
        `PRP-${p.ID}`,
        p.DATA_DA_PROSPECCAO || null,
        (p.EMPRESA || 'Empresa').trim(),
        empresaId,
        p.CNPJ || null,
        p.COMPETENCIA || null,
        p.VIDAS || '0',
        vidasNum,
        p.CIDADE || null,
        p.UF || 'BA',
        p.TKM || 'R$ 0,00',
        tkmNum,
        p.FATURAMENTO || 'R$ 0,00',
        fatNum,
        p.ACOMODACAO || 'Enfermaria',
        p.FATOR_MODERADOR || 'Mensalidade',
        p.POLITICA_COPARTICIPACAO || null,
        p.CORRETORES_1 || null,
        p.AGENCIAMENTO_1 || null,
        p.VITALICIO_1 || null,
        p.CORRETORES_2 || null,
        p.AGENCIAMENTO_2 || null,
        p.VITALICIO_2 || null,
        p.CORRETORES_3 || null,
        p.AGENCIAMENTO_3 || null,
        p.VITALICIO_3 || null,
        p.PLANO_CAMPANHA || null,
        p.Status_Campanha || 'Campanha Encerrada',
        p.TEMPERATURA_CONTRATO || 'Iniciada',
        p.Aptidao || 'Apto',
        p.Usuario || 'Lucas',
        p.Data_Inclusao || null,
        p.Hora_Inclusao || null,
        p.Tipo_Contrato || 'Empresarial',
        p.Qnt_Faixa_Etaria || null,
        p.Faixa_Etaria || null,
        p.Data_Analise_tecnica || null,
        p.Data_Avaliacao_Diretoria || null,
        p.Data_Envio_Corretor || null,
        p.Motivo_Declinio || null,
        p.Observacao || null,
        p.Conversao_Solus || null,
        p.Status_Contrato || null,
        p.Plataforma || null
      ]
    );
    propCount++;
  }

  await client.query('COMMIT;');
  console.log(`✓ ${propCount} propostas inseridas/atualizadas com sucesso.`);

  // 13. Verificação de contagens finais no banco
  console.log('\n--- Conferência de Contagens Finais no Supabase ---');
  const counts = await client.query(`
    SELECT 
      (SELECT COUNT(*) FROM public.companies) AS total_companies,
      (SELECT COUNT(*) FROM public.brokers) AS total_brokers,
      (SELECT COUNT(*) FROM public.campaigns) AS total_campaigns,
      (SELECT COUNT(*) FROM public.proposals) AS total_proposals,
      (SELECT COUNT(*) FROM public.coparticipation_policies) AS total_copart,
      (SELECT COUNT(*) FROM public.agency_policies) AS total_agency,
      (SELECT COUNT(*) FROM public.system_requirements) AS total_reqs;
  `);

  console.log(counts.rows[0]);
  console.log('\n🎉 MIGRAÇÃO PARA SUPABASE CONCLUÍDA COM TOTAL SUCESSO!');

  await client.end();
}

migrate().catch(err => {
  console.error('❌ Erro durante a migração:', err);
  process.exit(1);
});
