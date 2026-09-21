/**
 * CRM SB Saúde — Motor de Regras de Negócio (RN-01 a RN-10)
 * Implementa validações e cálculos certificados da extração e especificação de requisitos.
 */

const BusinessRules = {
  // RN-01: Identificação e rastreabilidade inicial
  generateUniqueId(existingProposals = []) {
    const maxNum = existingProposals.reduce((max, p) => {
      const n = parseInt(p.ID, 10);
      return !isNaN(n) && n > max ? n : max;
    }, 1072);
    return String(maxNum + 1);
  },

  getCurrentUser() {
    return localStorage.getItem('crm_active_user') || 'Lucas';
  },

  formatDateBR(date = new Date()) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
  },

  formatTimeBR(date = new Date()) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  },

  // RN-02: Competência: sempre o primeiro dia do mês da proposta (01/MM/AAAA)
  calculateCompetence(dateStr) {
    if (!dateStr) return '';
    let day, month, year;
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        month = parts[1].padStart(2, '0');
        year = parts[2];
        return `01/${month}/${year}`;
      }
    } else if (dateStr.includes('-')) {
      // YYYY-MM-DD
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        year = parts[0];
        month = parts[1].padStart(2, '0');
        return `01/${month}/${year}`;
      }
    }
    return '';
  },

  // RN-03: Faturamento = Vidas × TKM com arredondamento monetário
  parseCurrency(valStr) {
    if (typeof valStr === 'number') return valStr;
    if (!valStr) return 0;
    // Remove "R$", espaços, e trata ponto/vírgula pt-BR
    const cleaned = String(valStr)
      .replace(/[R$\s]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  },

  formatCurrency(num) {
    if (num === null || num === undefined || isNaN(num)) return 'R$ 0,00';
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },

  calculateRevenue(lives, tkm) {
    const livesNum = parseInt(lives, 10) || 0;
    const tkmNum = this.parseCurrency(tkm);
    const total = Math.round((livesNum * tkmNum) * 100) / 100;
    return {
      numeric: total,
      formatted: this.formatCurrency(total)
    };
  },

  // RN-04: Campanha vinculada pela competência
  matchCampaign(competence, campaignsCatalog = []) {
    if (!competence) {
      return { plan: '', status: 'Sem Campanha' };
    }
    const found = campaignsCatalog.find(c => c.competencia === competence || (c.competencias && c.competencias.includes(competence)));
    if (found) {
      return {
        plan: found.campanha,
        status: found.status || 'Campanha Encerrada'
      };
    }
    return {
      plan: 'Sem Campanha Ativa',
      status: 'Competência sem Campanha'
    };
  },

  // RN-05 & RN-06: Temperatura comercial e validação de declínio
  TEMPERATURAS: [
    'Iniciada',
    'Fria',
    'Morna',
    'Quente',
    'Contrato Fechado',
    'Desistência da Empresa',
    'Desistência por Ausência de Retorno',
    'Declinado pela SB Saúde'
  ],

  determineAptitude(temperature) {
    if (!temperature) return '';
    if (temperature === 'Declinado pela SB Saúde') {
      return 'Inapto';
    }
    return 'Apto';
  },

  validateDeclineReason(temperature, reason) {
    if (temperature === 'Declinado pela SB Saúde') {
      if (!reason || !reason.trim()) {
        return {
          valid: false,
          error: 'É obrigatório informar a justificativa do declínio quando o status é "Declinado pela SB Saúde" (RN-06).'
        };
      }
    }
    return { valid: true };
  },

  // RN-07: Planos, acomodações e faixas etárias
  ACOMODACOES: ['Ambulatorial', 'Enfermaria', 'Apartamento'],
  TIPOS_CONTRATO: ['Empresarial', 'PME', 'Coletivo por Adesão', 'Individual'],
  QNT_FAIXAS: ['Faixa Única', '2 Faixas', '3 Faixas', '4 Faixas', '5 Faixas', '6 Faixas', '7 Faixas', '8 Faixas', '9 Faixas', '10 Faixas'],

  // Faixas Etárias Oficiais (Padrão ANS / SB Saúde)
  FAIXAS_ETARIAS_PADRAO: [
    '00 a 18 anos',
    '19 a 23 anos',
    '24 a 28 anos',
    '29 a 33 anos',
    '34 a 38 anos',
    '39 a 43 anos',
    '44 a 48 anos',
    '49 a 53 anos',
    '54 a 58 anos',
    '59 anos acima'
  ],

  // Motivos de Declínio Padronizados do Sistema Legado
  MOTIVOS_DECLINIO: [
    'AUSENCIA DE REGISTRO DE RETORNO DO COMERCIAL',
    'AUSENCIA DE REDE NA REGIÃO',
    'ANALISE TECNICA',
    'CLIENTE OPTOU PELA COGENERE',
    'ENCAMINHADA PARA ADMNISTRADORA',
    'PREÇO / CONDIÇÃO COMERCIAL',
    'OUTRO MOTIVO'
  ],

  // Opções de Agenciamento do Sistema Legado
  OPCOES_AGENCIAMENTO: [
    'Padrão SB Saúde',
    '50,00%',
    '100,00%',
    'Isento / Sem Agenciamento'
  ],

  // Cache e Serviço de Cidades do Brasil (IBGE)
  _citiesCache: {},
  _capitalsFallback: {
    AC: ['Rio Branco', 'Cruzeiro do Sul', 'Sena Madureira', 'Tarauacá', 'Feijó'],
    AL: ['Maceió', 'Arapiraca', 'Palmeira dos Índios', 'Rio Largo', 'Penedo'],
    AP: ['Macapá', 'Santana', 'Laranjal do Jari', 'Oiapoque'],
    AM: ['Manaus', 'Parintins', 'Itacoatiara', 'Manacapuru', 'Coari'],
    BA: ['Salvador', 'Feira de Santana', 'Vitória da Conquista', 'Camaçari', 'Juazeiro', 'Itabuna', 'Lauro de Freitas', 'Ilhéus', 'Jequié', 'Alagoinhas', 'Jacobina', 'Candeias', 'Simões Filho'],
    CE: ['Fortaleza', 'Caucaia', 'Juazeiro do Norte', 'Maracanaú', 'Sobral'],
    DF: ['Brasília', 'Ceilândia', 'Taguatinga', 'Samambaia', 'Plano Piloto'],
    ES: ['Vitória', 'Vila Velha', 'Serra', 'Cariacica', 'Cachoeiro de Itapemirim'],
    GO: ['Goiânia', 'Aparecida de Goiânia', 'Anápolis', 'Rio Verde', 'Luziânia'],
    MA: ['São Luís', 'Imperatriz', 'São José de Ribamar', 'Timon', 'Caxias'],
    MT: ['Cuiabá', 'Várzea Grande', 'Rondonópolis', 'Sinop', 'Tangará da Serra'],
    MS: ['Campo Grande', 'Dourados', 'Três Lagoas', 'Corumbá', 'Ponta Porã'],
    MG: ['Belo Horizonte', 'Uberlândia', 'Contagem', 'Juiz de Fora', 'Betim', 'Montes Claros', 'Uberaba'],
    PA: ['Belém', 'Ananindeua', 'Santarém', 'Marabá', 'Parauapebas'],
    PB: ['João Pessoa', 'Campina Grande', 'Santa Rita', 'Patos', 'Bayeux'],
    PR: ['Curitiba', 'Londrina', 'Maringá', 'Ponta Grossa', 'Cascavel', 'São José dos Pinhais'],
    PE: ['Recife', 'Jaboatão dos Guararapes', 'Olinda', 'Caruaru', 'Petrolina', 'Paulista'],
    PI: ['Teresina', 'Parnaíba', 'Picos', 'Piripiri', 'Floriano'],
    RJ: ['Rio de Janeiro', 'São Gonçalo', 'Duque de Caxias', 'Nova Iguaçu', 'Niterói', 'Campos dos Goytacazes'],
    RN: ['Natal', 'Mossoró', 'Parnamirim', 'São Gonçalo do Amarante', 'Macaíba'],
    RS: ['Porto Alegre', 'Caxias do Sul', 'Canoas', 'Pelotas', 'Santa Maria'],
    RO: ['Porto Velho', 'Ji-Paraná', 'Ariquemes', 'Vilhena', 'Cacoal'],
    RR: ['Boa Vista', 'Rorainópolis', 'Caracaraí'],
    SC: ['Florianópolis', 'Joinville', 'Blumenau', 'São José', 'Chapecó', 'Criciúma'],
    SP: ['São Paulo', 'Guarulhos', 'Campinas', 'São Bernardo do Campo', 'São José dos Campos', 'Santo André', 'Ribeirão Preto', 'Osasco', 'Sorocaba', 'Jandira'],
    SE: ['Aracaju', 'Nossa Senhora do Socorro', 'Lagarto', 'Itabaiana', 'São Cristóvão'],
    TO: ['Palmas', 'Araguaína', 'Gurupi', 'Porto Nacional']
  },

  async fetchCitiesByUF(uf) {
    if (!uf) return [];
    const cleanUf = String(uf).trim().toUpperCase();
    if (this._citiesCache[cleanUf]) {
      return this._citiesCache[cleanUf];
    }

    // Tenta ler do localStorage
    try {
      const storageKey = `crm_cities_cache_${cleanUf}`;
      const local = localStorage.getItem(storageKey);
      if (local) {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this._citiesCache[cleanUf] = parsed;
          return parsed;
        }
      }
    } catch (e) {
      // Ignora erro de acesso ao localStorage
    }

    // Busca na API oficial do IBGE
    try {
      const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${cleanUf}/municipios`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          const names = data.map(item => item.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));
          this._citiesCache[cleanUf] = names;
          try {
            localStorage.setItem(`crm_cities_cache_${cleanUf}`, JSON.stringify(names));
          } catch (e) {
            // Cota local excedida não interrompe fluxo
          }
          return names;
        }
      }
    } catch (err) {
      console.warn(`[BusinessRules] Não foi possível consultar API IBGE para ${cleanUf}, usando fallback:`, err);
    }

    // Fallback de contingência offline
    const fallback = this._capitalsFallback[cleanUf] || [];
    this._citiesCache[cleanUf] = fallback;
    return fallback;
  },

  // RN-08: Agenciamento e Vitalício
  validateBrokerParticipation(p1, p2, p3) {
    if (!p1.broker || !p1.broker.trim()) {
      return { valid: false, error: 'O primeiro corretor é obrigatório (RN-08).' };
    }
    return { valid: true };
  },

  // RN-09: Fator moderador e coparticipação
  FATORES_MODERADORES: ['Mensalidade', 'Mensalidade + Coparticipação'],

  // RN-10: Login e Perfis
  USERS: [
    { username: 'Lucas', role: 'Supervisor Comercial', email: 'lucas@sbsaude.com.br' },
    { username: 'Eduardo', role: 'Gerente Comercial', email: 'eduardo@sbsaude.com.br' },
    { username: 'Julia', role: 'Analista de Negócios', email: 'julia@sbsaude.com.br' },
    { username: 'Juliana', role: 'Consultora de Vendas', email: 'juliana@sbsaude.com.br' },
    { username: 'IVAN LÁZARO', role: 'Diretor Comercial', email: 'ivan@sbsaude.com.br' }
  ]
};

if (typeof window !== 'undefined') {
  window.BusinessRules = BusinessRules;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BusinessRules;
}
