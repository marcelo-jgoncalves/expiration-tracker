# Expiration Tracker — Plano de Validação dos Wireframes Documentais

**Data:** 31 de agosto de 2026  
**Status:** PLANO DE VALIDAÇÃO v0.1  
**Base:** Wireframes Funcionais do Domínio Documental + Interface Quality Standard + Frontend Engineering Quality Standard.

---

# 1. Objetivo

Validar os wireframes antes de transformá-los em protótipos de alta fidelidade ou iniciar engenharia.

A validação deve procurar principalmente:

- confusão conceitual;
- fluxo desnecessariamente longo;
- informação ausente;
- excesso de informação;
- ações perigosas;
- estados não representados;
- problemas de acessibilidade;
- inconsistências com o restante do Expiration Tracker.

---

# 2. Evidência necessária

Esta etapa ainda não é validação com clientes reais.

Ela deve combinar:

```text
revisão heurística
+
revisão adversarial
+
personas sintéticas
+
walkthrough de jornadas
+
checagem de acessibilidade estrutural
```

O resultado deve ser tratado como:

```text
DESIGN EVIDENCE
```

e não como:

```text
USER VALIDATED
```

---

# 3. Personas sintéticas iniciais

## P1 — Sócia de escritório contábil

**Perfil**

- 42 anos;
- administra escritório com 12 funcionários;
- atende 110 empresas;
- usa Conta Azul e WhatsApp;
- quer reduzir dependência de planilhas;
- pouco tempo para configurar sistemas.

**Pergunta central**

> Consigo entender rapidamente se a documentação dos meus clientes está em ordem?

---

## P2 — Analista operacional

**Perfil**

- trabalha diariamente com documentos;
- controla vencimentos;
- cobra clientes;
- revisa arquivos;
- alto volume;
- precisa trabalhar rápido.

**Pergunta central**

> O sistema diminui trabalho ou apenas cria mais etapas?

---

## P3 — Usuário pouco técnico

**Perfil**

- domina tarefas contábeis;
- não gosta de interfaces complexas;
- usa navegador, e-mail e WhatsApp;
- termos técnicos confundem.

**Pergunta central**

> Os rótulos são compreensíveis sem treinamento?

---

## P4 — Gestor com visão de risco

**Perfil**

- não opera documentos diariamente;
- quer saber o que está vencido, faltando e aguardando;
- usa dashboard e relatórios.

**Pergunta central**

> Consigo saber em 30 segundos onde está o risco?

---

## P5 — Guest / cliente do escritório

**Perfil**

- recebeu um link por WhatsApp;
- nunca viu o Expiration Tracker;
- está no celular;
- quer apenas enviar o arquivo.

**Pergunta central**

> Consigo enviar o documento sem entender o produto?

---

## P6 — Usuário avançado

**Perfil**

- administra centenas/milhares de documentos;
- usa teclado;
- filtra;
- busca;
- trabalha com grande volume.

**Pergunta central**

> A interface escala para trabalho operacional intenso?

---

## P7 — Usuário com baixa visão

**Perfil**

- usa zoom;
- depende de contraste;
- pode usar leitor de tela.

**Pergunta central**

> Consigo distinguir estados e executar fluxos sem depender de cor?

---

## P8 — Usuário propenso a erros

**Perfil**

- faz upload rápido;
- clica duas vezes;
- confunde versão com complemento;
- fecha telas;
- perde conexão.

**Pergunta central**

> O produto previne erros e ajuda a recuperar quando eles acontecem?

---

# 4. Cenários obrigatórios

Cada persona aplicável deve percorrer cenários como:

```text
S1 — cadastrar documento
S2 — corrigir sugestão de IA
S3 — documento permanente
S4 — solicitar documento
S5 — guest upload
S6 — revisar e aceitar
S7 — revisar e recusar
S8 — renovar documento
S9 — nova versão
S10 — Requirement ausente
S11 — encontrar documento
S12 — arquivar
S13 — falha de upload
S14 — unknown outcome
S15 — mobile
```

---

# 5. Perguntas de walkthrough

Para cada tela:

1. Onde você está?
2. Qual é a tarefa principal?
3. Qual ação você faria primeiro?
4. Você entende o status?
5. Sabe quem é responsável?
6. Sabe qual versão é atual?
7. Sabe se a informação foi confirmada ou sugerida?
8. Sabe como voltar?
9. Sabe o que acontece ao clicar?
10. Existe alguma informação que parece desnecessária?

---

# 6. Critérios de avaliação

Usar os seguintes eixos:

| Eixo | Pergunta |
|---|---|
| Clareza | O usuário entende o que está vendo? |
| Findability | Encontra a ação certa? |
| Eficiência | Consegue executar sem passos desnecessários? |
| Integridade | Estados não criam falsa certeza? |
| Error safety | O produto evita dano e duplicidade? |
| Accessibility | Funciona sem cor/hover e com teclado? |
| Consistência | Parece parte do Expiration Tracker? |
| Responsividade | Continua funcional em mobile? |
| Densidade | Mostra informação suficiente sem sobrecarga? |
| Confiança | O usuário entende histórico e responsabilidade? |

---

# 7. Escala de severidade

## S0 — observação

Preferência ou melhoria sem impacto real.

## S1 — pequeno

Fricção localizada.

## S2 — moderado

Dificulta tarefa ou entendimento.

## S3 — grave

Pode causar erro operacional relevante.

## S4 — crítico

Pode causar:

- vazamento;
- perda de histórico;
- falsa confirmação;
- ação no tenant errado;
- impossibilidade de concluir jornada crítica.

---

# 8. Gates funcionais

Antes de alta fidelidade:

## Gate 1 — Critical Task

Nenhuma jornada crítica pode estar bloqueada.

## Gate 2 — Information Integrity

Deve estar claro:

```text
Received != Accepted
Suggested != Confirmed
Current != Superseded
```

## Gate 3 — Error Safety

Nenhum erro comum pode facilmente:

- apagar histórico;
- duplicar operação;
- sobrescrever versão;
- aceitar documento errado.

## Gate 4 — Accessibility

Fluxos críticos devem ser estruturalmente compatíveis com teclado e WCAG 2.2 AA.

## Gate 5 — Navigation

O usuário deve conseguir navegar entre:

```text
Subject
Requirement
Document
Request
Renewal
```

sem perder contexto.

---

# 9. Critérios específicos por wireframe

## WF01 Documents Collection

Validar:

- prioridade das colunas;
- quantidade de filtros;
- entendimento de status;
- densidade;
- ação “Solicitar”.

## WF02 Document Detail

Validar:

- excesso de informação;
- versão atual;
- ação de renovação;
- relação com Subject.

## WF03 New Document

Validar:

- ordem dos campos;
- sugestão vs confirmação;
- permanente;
- responsável.

## WF04 Requirements

Validar:

- diferença entre requisito e documento;
- ações Missing/Expiring.

## WF05 Request

Validar:

- destinatário;
- mensagem;
- preview;
- prazo.

## WF06 Guest

Validar:

- zero treinamento;
- celular;
- contexto mínimo.

## WF08/WF09 Review

Validar:

- velocidade;
- segurança;
- motivos de recusa;
- extração.

## WF11 Renewal

Validar:

- “já tenho” vs “solicitar”;
- continuidade mental.

---

# 10. Testes adversariais

Simular:

### A1

Usuário tenta enviar o mesmo arquivo duas vezes.

### A2

Usuário inicia renovação e perde conexão.

### A3

IA sugere data errada.

### A4

Guest envia documento vencido.

### A5

Guest envia arquivo de outra empresa.

### A6

Usuário adiciona “nova versão” quando queria complemento.

### A7

Usuário troca Organization durante formulário.

### A8

Documento atual já venceu enquanto Renewal está aberta.

### A9

Request é respondido depois do prazo.

### A10

Usuário tenta arquivar documento que satisfaz Requirement crítico.

---

# 11. Teste de densidade

Criar dataset sintético:

```text
1.000 Documents
200 Subjects
25 Document Types
50 usuários
15 statuses combinados
```

Validar:

- tabela;
- filtros;
- nomes longos;
- scrolling;
- ordenação;
- mobile.

---

# 12. Teste de conteúdo extremo

Exemplos:

```text
Razão social:
ASSOCIAÇÃO DOS PRODUTORES E DISTRIBUIDORES DE SERVIÇOS...

Filename:
certidao-negativa-de-debitos-municipais-padaria-central-versao-final-assinada.pdf
```

Comentários de recusa longos.

Mensagens longas.

Nenhum conteúdo crítico deve ficar inacessível.

---

# 13. Teste mobile

Obrigatório para:

- Documents;
- New Document;
- Guest Upload;
- Review;
- Renewal;
- Requirement.

Validar:

```text
320–375px
```

sem exigir gesto de hover.

---

# 14. Saída esperada da validação

Produzir tabela:

| ID | Tela | Persona | Finding | Severity | Recomendação |
|---|---|---|---|---|---|
| F001 | WF03 | P3 | “Versão” confunde usuário | S2 | Alterar microcopy |
| F002 | WF09 | P8 | Aceite muito fácil | S3 | Reforçar resumo |
| ... | ... | ... | ... | ... | ... |

---

# 15. Critério para avançar

Pode avançar para protótipo de alta fidelidade quando:

- nenhum S4;
- nenhum S3 em jornada crítica;
- gates aprovados;
- termos principais compreendidos;
- fluxo ponta a ponta coerente;
- mobile funcional;
- IA não cria falsa certeza;
- Requirements e Documents são distinguíveis.

---

# 16. Papel de Claude e Codex

Sugestão de processo:

```text
Claude
→ avaliação heurística principal

Codex
→ revisão adversarial independente

comparação
→ findings

correção

nova rodada
```

Se esse trabalho for classificado como mudança de alto risco conforme governança do projeto, seguir o protocolo Claude↔Codex aplicável.

---

# 17. Limite da validação sintética

Personas sintéticas podem detectar:

- incoerência;
- ambiguidade;
- edge cases;
- gaps;
- problemas de acessibilidade estrutural;
- carga cognitiva aparente.

Não podem provar:

```text
usabilidade real
willingness to pay
adoção
comportamento cotidiano
```

Esses pontos exigirão usuários reais.

---

# 18. Próxima etapa

Após a validação dos wireframes:

```text
Wireframes aprovados
        ↓
Protótipo visual de alta fidelidade
        ↓
Design System
        ↓
nova revisão
        ↓
teste com personas sintéticas
        ↓
teste com primeiros usuários reais
        ↓
engenharia
```

O protótipo de alta fidelidade deve preservar a estrutura aprovada e não reabrir arbitrariamente decisões funcionais já fechadas.
