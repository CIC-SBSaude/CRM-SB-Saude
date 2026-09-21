# CRM SB Saúde — análises dinâmicas

## Como abrir

1. Instale Node.js 22 ou superior, se necessário.
2. Nesta pasta, execute `node server.js`.
3. Abra `http://127.0.0.1:8080` no navegador e entre com seu usuário do CRM.
4. No menu lateral, escolha **Análises dinâmicas**. O Dashboard Executivo também oferece o botão **Montar análise personalizada**.

Se a porta 8080 estiver ocupada, defina a variável de ambiente `PORT` antes de iniciar o servidor.

## Montar uma análise

- **Linhas:** agrupa propostas por competência, estado, corretor, empresa ou outro campo disponível.
- **Colunas:** cruza as linhas com uma segunda dimensão, como etapa do contrato.
- **Medida:** escolha quantidade de propostas, total ou média de vidas, faturamento ou TKM médio.
- **Filtros:** adicione um ou mais valores. Os filtros se combinam entre si.
- **Gráfico e ordenação:** escolha barras, linhas ou rosca e a ordem de exibição.
- **Salvar análise:** guarda a configuração da visualização no navegador para o usuário atual. Ao reabrir, selecione o nome em **Visualização salva**.
- **Exportar CSV:** gera a tabela completa, inclusive os grupos que não aparecem na prévia de 100 linhas. O arquivo pode ser aberto no Excel ou em outra planilha.

O gráfico apresenta até 15 grupos; a tabela apresenta até 100 na tela. Os cálculos e o CSV incluem todos os grupos. Os valores são recalculados a partir das propostas atuais da aplicação. As análises salvas ficam no armazenamento local deste navegador e não são sincronizadas entre dispositivos.
