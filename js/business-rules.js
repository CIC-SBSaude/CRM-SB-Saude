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
  QNT_FAIXAS: ['Faixa Única', '2 Faixas', '3 Faixas', '4 Faixas', '5 Faixas', '6 Faixas', '7 Faixas', '8 Faixas', '9 Faixas'],

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
