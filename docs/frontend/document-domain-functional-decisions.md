# Expiration Tracker — Decisões Funcionais do Domínio Documental

**Data:** 31 de agosto de 2026  
**Status:** APROVADO COMO DIREÇÃO FUNCIONAL INICIAL  
**Escopo:** fechamento das decisões D1–D10 da especificação funcional v0.1.  
**Fora de escopo:** arquitetura técnica, AWS, banco de dados, APIs, segurança de implementação e desenho de infraestrutura.

---

# 1. Objetivo

Este documento fecha as dez decisões funcionais propostas para o domínio documental do Expiration Tracker.

A finalidade é estabelecer uma base de produto coerente antes de avançar para:

- jornadas detalhadas;
- critérios de aceitação;
- desenho de telas;
- contratos funcionais;
- arquitetura técnica.

Princípio norteador:

> **O Expiration Tracker não é um repositório genérico de arquivos. É uma plataforma para acompanhar obrigações e documentos ao longo do tempo, com validade, responsabilidade, renovação e histórico.**

Modelo conceitual:

```text
Requirement
    ↓
Document
    ↓
Document Version
    ↓
Validity
    ↓
Expiration
    ↓
Renewal
    ↓
History
```

Com:

```text
Document Request
+
Review
+
Responsible
+
AI Assistance
```

como capacidades operacionais.

---

# 2. D1 — `Document` é uma entidade lógica duradoura

## Decisão

**APROVADO.**

`Document` representa a identidade lógica contínua de um documento ao longo do tempo.

Exemplo:

```text
Document
Alvará de Funcionamento — Padaria Central Ltda.
```

não representa apenas um PDF específico.

## Justificativa

O valor do produto está no acompanhamento histórico.

Se cada renovação fosse um `Document` diferente, perderíamos:

- continuidade;
- histórico;
- clareza de qual documento substituiu qual;
- rastreabilidade;
- visão consolidada da obrigação;
- experiência natural de renovação.

## Consequência funcional

O usuário enxerga:

```text
Alvará de Funcionamento
├── versão 2025
├── versão 2026
└── versão 2027 — atual
```

e não três documentos independentes.

---

# 3. D2 — Renovação cria nova `Document Version`

## Decisão

**APROVADO.**

Renovar um documento não deve editar silenciosamente a versão existente.

Uma renovação bem-sucedida cria uma nova `Document Version`.

## Regra

```text
versão atual
    ↓
processo de renovação
    ↓
nova versão recebida
    ↓
revisão
    ↓
nova versão aceita
    ↓
versão anterior → SUPERSEDED
nova versão → ACCEPTED
```

## Justificativa

Uma renovação representa um novo fato documental.

Alterar apenas a data de validade destruiria evidência histórica.

## Consequência

O sistema deve preservar:

- arquivo anterior;
- validade anterior;
- data de emissão anterior;
- responsável;
- origem;
- eventos;
- histórico de substituição.

---

# 4. D3 — Documentos permanentes são suportados

## Decisão

**APROVADO.**

O domínio documental deve suportar documentos sem vencimento.

## Exemplos

- contrato social;
- alteração societária;
- comprovante histórico;
- documento cadastral;
- ata;
- certificado sem prazo explícito.

## Regra

O usuário deve poder classificar a validade como:

```text
possui validade
```

ou:

```text
não se aplica / permanente
```

## Justificativa

O arquivo documental seria artificialmente limitado se aceitasse apenas documentos com expiração.

Além disso, um mesmo Subject frequentemente possui:

```text
documentos permanentes
+
documentos renováveis
```

## Consequência

`Validity = NOT_APPLICABLE` é um estado funcional legítimo.

---

# 5. D4 — Versionamento faz parte do núcleo documental

## Decisão

**APROVADO.**

Versionamento não será uma funcionalidade Premium opcional.

É uma característica básica do modelo documental.

## Justificativa

Sem versionamento:

- renovação perde coerência;
- histórico é frágil;
- substituição pode causar perda de evidência;
- o usuário não sabe qual arquivo era válido anteriormente.

## Escopo básico

Todo plano que permita armazenamento documental deve preservar versões anteriores.

## Premium

O Premium pode ampliar:

- profundidade de histórico visível;
- auditoria;
- comparação;
- exportação;
- busca nas versões;
- relatórios.

Mas não deve transformar “não perder o documento anterior” em recurso premium.

---

# 6. D5 — `Received` e `Accepted` são estados distintos

## Decisão

**APROVADO.**

Receber um arquivo não significa aceitar aquele arquivo como evidência válida.

## Fluxo

```text
RECEIVED
    ↓
UNDER_REVIEW
   ↙          ↘
ACCEPTED     REJECTED
```

## Exemplos de rejeição

- documento vencido;
- arquivo ilegível;
- Subject incorreto;
- documento errado;
- versão antiga;
- conteúdo incompleto.

## Justificativa

Essa separação é necessária principalmente para:

- guest upload;
- documentos enviados por clientes;
- automação;
- IA;
- processos com validação humana.

## Consequência

Um Requirement não deve ser considerado satisfeito apenas porque um arquivo chegou.

---

# 7. D6 — IA sugere; humano confirma

## Decisão

**APROVADO COM REGRA DE EVOLUÇÃO.**

Na primeira estratégia funcional, dados extraídos por IA são sugestões.

## Fluxo

```text
arquivo
    ↓
extração
    ↓
campo sugerido
    ↓
revisão
    ↓
CONFIRMED / CORRECTED / REJECTED
```

## Regra de integridade

A interface deve distinguir:

```text
sugerido
```

de:

```text
confirmado
```

## Justificativa

Campos como validade podem gerar:

- alertas;
- obrigações;
- renovação;
- decisões operacionais.

Uma interpretação errada não deve ser convertida silenciosamente em verdade.

## Evolução futura permitida

O produto poderá futuramente permitir autoaceitação limitada quando existirem:

- tipo documental conhecido;
- campo específico;
- confiança comprovadamente alta;
- política configurável;
- evidência operacional suficiente.

Essa possibilidade futura não altera a regra inicial.

---

# 8. D7 — Não haverá árvore arbitrária de pastas inicialmente

## Decisão

**APROVADO.**

O produto não começará com organização livre por pastas e subpastas.

## Organização principal

```text
Organization
↓
Subject
↓
Document Type
↓
Document
↓
Version
```

Complementada por:

- categorias;
- filtros;
- pesquisa;
- Requirements;
- responsáveis;
- status.

## Justificativa

Uma árvore arbitrária empurraria o produto para a categoria de Drive/GED genérico.

Nosso valor está no contexto operacional do documento.

## Consequência

A necessidade de “organização” deve ser resolvida prioritariamente por metadados e relações de negócio.

## Regra de reavaliação

Pastas só devem ser consideradas futuramente se usuários reais demonstrarem um caso de uso importante que não possa ser bem atendido por:

```text
Subject + Tipo + Categoria + Busca + Filtros
```

---

# 9. D8 — Guest Upload faz parte do modelo funcional

## Decisão

**APROVADO.**

Uma pessoa externa poderá fornecer um documento sem necessariamente possuir conta completa no Expiration Tracker.

## Fluxo principal

```text
Document Request
    ↓
link
    ↓
upload externo
    ↓
RECEIVED
    ↓
revisão interna
```

## Justificativa

No ICP contábil, frequentemente:

```text
escritório
precisa do documento
de um cliente
```

Obrigar cada cliente a criar usuário aumentaria fricção.

## Limite funcional

Guest Upload não significa Portal do Cliente completo.

O primeiro objetivo é:

> receber corretamente aquilo que foi solicitado.

---

# 10. D9 — Requirements pertencem ao domínio documental

## Decisão

**APROVADO.**

`Requirement` será tratado como conceito funcional de primeira classe.

## Definição

Requirement representa:

> algo que um Subject precisa possuir, apresentar ou manter válido.

Exemplo:

```text
Fornecedor ACME
precisa manter
CND Federal válida
```

## Relação

```text
Requirement
    ↓
satisfeito por
    ↓
Document / Document Version
```

## Estados principais

```text
MISSING
PENDING
SATISFIED
EXPIRING
NOT_SATISFIED
NOT_APPLICABLE
```

## Justificativa

Sem Requirement, o produto consegue responder:

> “Quais documentos temos?”

Mas não consegue responder completamente:

> “O que deveria existir e está faltando?”

Esse segundo tipo de pergunta possui grande valor operacional.

---

# 11. D10 — Storage básico em planos pagos; Premium vende capacidade avançada

## Decisão

**APROVADO COMO HIPÓTESE DE PRODUTO.**

Todos os planos pagos devem possuir alguma capacidade documental.

## Base

Deve incluir:

- upload;
- armazenamento;
- preview básico;
- download;
- ligação com Subject;
- validade;
- versionamento;
- histórico básico;
- renovação.

## Premium

Pode diferenciar por:

- mais armazenamento;
- OCR;
- IA;
- busca no conteúdo;
- solicitações recorrentes;
- templates avançados;
- review queue avançada;
- auditoria ampliada;
- dossiê/exportação;
- capacidades avançadas de coleta.

## Justificativa

O mercado já trata armazenamento como expectativa da categoria.

Cobrar Premium apenas para permitir anexar um documento deixaria o plano inferior artificialmente limitado.

## Observação

Limites exatos de:

```text
GB
processamentos
documentos
requests
```

serão definidos posteriormente com base em unit economics e validação comercial.

---

# 12. Decisões complementares fechadas nesta rodada

Além de D1–D10, algumas questões abertas da especificação v0.1 podem ser fechadas funcionalmente agora.

---

## C1 — Um `Document` deve normalmente pertencer a um `Subject`

**DECISÃO: SIM, como regra padrão.**

O contexto do produto é operacional.

Um documento sem Subject perde boa parte de seu significado.

### Exceção

Pode existir documento temporariamente sem Subject durante:

- importação;
- inbox;
- triagem;
- captura inicial.

Mas deve existir um estado claramente pendente de classificação.

---

## C2 — Review obrigatório para guest upload

**DECISÃO: SIM.**

Todo upload externo deve chegar como:

```text
RECEIVED
```

e depender de aceite interno.

---

## C3 — Upload interno pode ser aceito diretamente

**DECISÃO: SIM.**

Quando um usuário autorizado envia o documento internamente, a experiência pode permitir:

```text
Enviar e aceitar
```

desde que os dados relevantes tenham sido confirmados.

Não há necessidade de introduzir burocracia artificial.

---

## C4 — Uma Document Version pode possuir vários arquivos

**DECISÃO: SIM.**

Uma versão pode conter:

```text
arquivo principal
+
arquivos complementares
```

Exemplo:

```text
Contrato
├── contrato.pdf
├── anexo.pdf
└── aditivo.pdf
```

---

## C5 — Excluir e arquivar são ações diferentes

**DECISÃO: SIM.**

### Arquivar

Mantém histórico.

### Excluir

Remove um item criado por engano ou dentro das regras de retenção aplicáveis.

A política técnica e legal de exclusão será definida depois.

---

## C6 — Request pode possuir prazo

**DECISÃO: SIM, opcional inicialmente.**

O prazo melhora:

- cobrança;
- priorização;
- dashboard;
- follow-up.

Mas não deve ser obrigatório para todo pedido.

---

# 13. Questões deliberadamente mantidas abertas

Algumas decisões devem permanecer abertas até termos mais evidência.

## A1 — Viewer pode baixar arquivos?

Depende da matriz RBAC final.

## A2 — Autoaceitação por IA

Não no primeiro modelo; reavaliar com dados.

## A3 — Portal do Cliente completo

Não faz parte do primeiro escopo.

## A4 — Pastas

Não no primeiro modelo.

## A5 — Assinatura eletrônica

Não faz parte desta rodada.

## A6 — Limites por plano

Depende de custos, pricing e experimentação comercial.

---

# 14. Modelo funcional consolidado

```text
Organization
    ↓
Subject
    ↓
Requirement
    ↓
Document
    ↓
Document Version
    ↓
Document File
```

Ciclo:

```text
Requirement
    ↓
MISSING
    ↓
Document Request
    ↓
Guest/Internal Upload
    ↓
RECEIVED
    ↓
Review
    ↓
ACCEPTED
    ↓
Validity
    ↓
Expiration
    ↓
Renewal
    ↓
New Document Version
    ↓
History
```

---

# 15. Invariantes funcionais

As seguintes regras passam a orientar o produto:

1. **Documento lógico não é igual a arquivo.**
2. **Renovar não sobrescreve histórico.**
3. **Recebido não significa aceito.**
4. **Aceito não significa necessariamente válido.**
5. **Documento pode ser permanente.**
6. **IA sugere antes de confirmar.**
7. **Requirement representa o que deveria existir.**
8. **Document representa o que existe ou existiu.**
9. **Guest Upload reduz fricção, mas não pula revisão.**
10. **Storage é uma capacidade do domínio, não a proposta de valor isolada.**
11. **Organização acontece pelo contexto de negócio, não por pastas arbitrárias.**
12. **Histórico deve sobreviver à renovação.**

---

# 16. Resultado da rodada

As decisões D1–D10 estão funcionalmente fechadas para permitir o avanço do desenho de produto.

Próxima etapa:

> detalhar as jornadas do usuário e os critérios de aceitação funcionais para cada jornada crítica.

Depois disso será possível entrar em:

- prototipação detalhada;
- desenho de interação;
- contratos funcionais;
- arquitetura técnica;
- planejamento de implementação.
