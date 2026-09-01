# Expiration Tracker — Wireframes Funcionais do Domínio Documental

**Data:** 31 de agosto de 2026  
**Status:** WIREFRAMES FUNCIONAIS v0.1  
**Base:** Arquitetura de Informação + Especificação de Telas + Design System “Operational Calm”  
**Escopo:** wireframes de baixa fidelidade das telas e jornadas críticas.  
**Fora de escopo:** identidade visual final, código, APIs, AWS, banco de dados e infraestrutura.

---

# 1. Objetivo

Transformar a especificação funcional do domínio documental em wireframes suficientemente concretos para validar:

- hierarquia de informação;
- navegação;
- densidade;
- ações primárias;
- estados;
- transições;
- relação entre Document, Version, Requirement, Request e Renewal.

Os wireframes são deliberadamente de baixa fidelidade.

Eles validam **estrutura e comportamento**, não acabamento visual.

---

# 2. Jornada crítica usada como eixo

```text
Subject
↓
Requirement ausente
↓
Solicitar documento
↓
Guest Upload
↓
Review
↓
Aceitar
↓
Document Detail
↓
Validade
↓
Vencendo
↓
Renewal
↓
Nova versão
↓
Histórico
```

Essa jornada deve permanecer coerente entre todas as telas.

---

# 3. WF01 — Documents Collection

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Documentos                                        [Solicitar] [ + Adicionar ]│
│                                                                              │
│ 12 vencidos   18 vencendo   5 aguardando revisão   7 ausentes              │
├──────────────────────────────────────────────────────────────────────────────┤
│ [ Buscar documentos...                         ] [Filtros] [Ordenar]         │
│                                                                              │
│ [Todos] [Válidos] [Vencendo] [Vencidos] [Permanentes] [Revisão]            │
├──────────────────────────────────────────────────────────────────────────────┤
│ Documento              Subject              Situação      Validade      Resp. │
├──────────────────────────────────────────────────────────────────────────────┤
│ Alvará Funcionamento   Padaria Central      Vence em 15d  15/09/26     Maria │
│ CND Federal            ACME Ltda.            Válido         20/12/26     João  │
│ Contrato Social        XPTO Ltda.            Permanente     —            Ana   │
│ Apólice                Beta Serviços         Vencido        28/08/26     Carlos│
│                                                                              │
│ [1] [2] [3] ...                                                     1–25/183 │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Hierarquia

1. tarefa principal;
2. indicadores de atenção;
3. busca/filtros;
4. tabela operacional.

## Ação primária

```text
Adicionar documento
```

## Ação secundária forte

```text
Solicitar documento
```

## Observação

Os cards de resumo não devem competir visualmente com a tabela.

---

# 4. WF02 — Document Detail

```text
Documentos / Alvará de Funcionamento

┌──────────────────────────────────────────────────────────────────────────────┐
│ Alvará de Funcionamento                         [Vence em 15 dias]           │
│ Padaria Central Ltda.                                                      │
│                                                                              │
│ Validade: 15/09/2026   Responsável: Maria Silva   Versão atual: v3          │
│                                                                              │
│                       [Nova versão] [Iniciar renovação] [⋯]                 │
├───────────────────────────────────────┬──────────────────────────────────────┤
│                                       │ Versão atual                         │
│                                       │                                      │
│             PREVIEW PDF               │ Arquivo                              │
│                                       │ alvara-2026.pdf                      │
│                                       │                                      │
│                                       │ Emissão                              │
│                                       │ 20/05/2026                           │
│                                       │                                      │
│                                       │ Validade                             │
│                                       │ 15/09/2026                           │
│                                       │                                      │
│                                       │ Origem                               │
│                                       │ Upload interno                       │
│                                       │                                      │
│                                       │ Confirmado por                       │
│                                       │ Maria Silva                          │
├───────────────────────────────────────┴──────────────────────────────────────┤
│ [Versão atual] [Versões] [Relacionados] [Histórico]                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Histórico recente                                                            │
│                                                                              │
│ Hoje      Maria alterou responsável para João                               │
│ 22/05     Maria confirmou validade 15/09/2026                               │
│ 22/05     Versão 3 aceita                                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Regras

- versão atual inequívoca;
- validade no header;
- ação de renovação próxima da validade;
- histórico secundário, mas acessível;
- preview não deve esconder metadados críticos.

---

# 5. WF03 — New Document / Upload

```text
Adicionar documento

┌──────────────────────────────────────────────────────────────────────────────┐
│ Subject                                                                      │
│ [ Padaria Central Ltda.                                    ▼ ]              │
│                                                                              │
│ Tipo de documento                                                            │
│ [ Alvará de Funcionamento                                  ▼ ]              │
│                                                                              │
│ Arquivo                                                                      │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Arraste o arquivo aqui ou [Selecionar arquivo]                           │ │
│ │ PDF, JPG, PNG                                                            │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│                                                        [Cancelar] [Continuar]│
└──────────────────────────────────────────────────────────────────────────────┘
```

Após upload:

```text
Revise as informações

┌──────────────────────────────────────────────────────────────────────────────┐
│ Arquivo: alvara-padaria.pdf                                                  │
│                                                                              │
│ Tipo                                                                         │
│ [ Alvará de Funcionamento                                ] [Sugerido]        │
│                                                                              │
│ Emissão                                                                      │
│ [ 20/05/2026                                            ] [Sugerido]        │
│                                                                              │
│ Validade                                                                     │
│ [ 18/05/2027                                            ] [Sugerido]        │
│                                                                              │
│ [ ] Documento permanente                                                     │
│                                                                              │
│ Responsável                                                                  │
│ [ Maria Silva                                             ▼ ]              │
│                                                                              │
│ Observações                                                                  │
│ [                                                                    ]       │
│                                                                              │
│                                               [Voltar] [Salvar documento]    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Regra

“Sugerido” não equivale a confirmado.

O usuário deve conseguir corrigir antes de salvar.

---

# 6. WF04 — Subject / Requirements

```text
Padaria Central Ltda.

[Resumo] [Documentos] [Vencimentos] [Requisitos] [Histórico]

┌──────────────────────────────────────────────────────────────────────────────┐
│ Requisitos                                           [Aplicar template]      │
│                                                                              │
│ 7 satisfeitos   1 ausente   1 vencendo                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ Requisito          Situação       Documento atual       Validade      Ação   │
├──────────────────────────────────────────────────────────────────────────────┤
│ CND Federal        Satisfeito     CND Federal           30/01/27      Abrir  │
│ CND Estadual       Satisfeito     CND Estadual          28/02/27      Abrir  │
│ CND Municipal      Ausente        —                     —             Solic. │
│ Alvará             Vencendo       Alvará                15/09/26      Renovar│
└──────────────────────────────────────────────────────────────────────────────┘
```

## Ponto-chave

A tela mostra simultaneamente:

```text
o que deveria existir
```

e:

```text
o que comprova que existe
```

---

# 7. WF05 — New Document Request

```text
Solicitar documento

┌──────────────────────────────────────────────────────────────────────────────┐
│ Subject                                                                      │
│ [ Padaria Central Ltda.                                    ▼ ]              │
│                                                                              │
│ Documento esperado                                                           │
│ [ CND Municipal                                            ▼ ]              │
│                                                                              │
│ Destinatário                                                                 │
│ [ financeiro@padariacentral.com.br                         ]                │
│                                                                              │
│ Prazo                                                                        │
│ [ 10/09/2026                           ]  Opcional                          │
│                                                                              │
│ Responsável interno                                                          │
│ [ Maria Silva                                             ▼ ]              │
│                                                                              │
│ Mensagem                                                                     │
│ [ Precisamos da CND Municipal atualizada para manter...               ]     │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Prévia para o destinatário                                                   │
│                                                                              │
│ Escritório Alfa solicita:                                                    │
│ CND Municipal — Padaria Central Ltda.                                        │
│ Prazo: 10/09/2026                                                            │
│                                                                              │
│                                                 [Cancelar] [Enviar solicitação]│
└──────────────────────────────────────────────────────────────────────────────┘
```

## Regra

O usuário vê exatamente o que será enviado antes do envio.

---

# 8. WF06 — Guest Upload

```text
┌──────────────────────────────────────────────────────────────┐
│ Expiration Tracker                                           │
│ Escritório Alfa                                              │
│                                                              │
│ Documento solicitado                                         │
│                                                              │
│ CND Municipal                                                │
│ Padaria Central Ltda.                                        │
│                                                              │
│ Prazo                                                        │
│ 10/09/2026                                                   │
│                                                              │
│ Precisamos da certidão atualizada para manter                │
│ sua documentação em dia.                                    │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Selecione o documento                                   │ │
│ │ [Escolher arquivo]                                      │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│                                       [Enviar documento]     │
└──────────────────────────────────────────────────────────────┘
```

## Não exibir

- sidebar;
- documentos existentes;
- usuários internos;
- histórico;
- dados não necessários.

---

# 9. WF07 — Guest Confirmation

```text
┌──────────────────────────────────────────────────────────────┐
│ ✓ Documento enviado                                         │
│                                                              │
│ Recebemos:                                                   │
│ cnd-municipal.pdf                                            │
│                                                              │
│ O escritório ainda poderá revisar o documento antes         │
│ de aceitá-lo.                                                │
│                                                              │
│ Você pode fechar esta página.                                │
└──────────────────────────────────────────────────────────────┘
```

## Regra

Nunca escrever:

```text
Documento aprovado
```

antes da revisão.

---

# 10. WF08 — Review Queue

```text
Aguardando revisão

5 documentos pendentes

┌──────────────────────────────────────────────────────────────────────────────┐
│ [Buscar...] [Subject ▼] [Responsável ▼] [Mais filtros]                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Documento         Subject          Enviado por        Recebido      Ação     │
├──────────────────────────────────────────────────────────────────────────────┤
│ CND Municipal     Padaria Central  Cliente externo    Hoje 10:32    Abrir    │
│ Procuração        ACME Ltda.       João Cliente       Ontem         Abrir    │
│ Apólice           Beta Serviços    Ana                29/08         Abrir    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Empty

```text
Nenhum documento aguardando revisão.
Tudo revisado por enquanto.
```

---

# 11. WF09 — Review Detail

```text
CND Municipal
Padaria Central Ltda.

┌───────────────────────────────────────┬──────────────────────────────────────┐
│                                       │ Solicitação                          │
│                                       │ CND Municipal                        │
│             PREVIEW PDF               │                                      │
│                                       │ Enviado por                          │
│                                       │ financeiro@padaria...                │
│                                       │                                      │
│                                       │ Recebido                             │
│                                       │ Hoje, 10:32                          │
│                                       │                                      │
│                                       │ Dados identificados                  │
│                                       │                                      │
│                                       │ Emissão                              │
│                                       │ 01/09/2026 [Sugerido]                │
│                                       │                                      │
│                                       │ Validade                             │
│                                       │ 30/11/2026 [Sugerido]                │
│                                       │                                      │
│                                       │ [Confirmar campos]                   │
├───────────────────────────────────────┴──────────────────────────────────────┤
│ [Recusar]                                              [Aceitar documento]  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Recusa

```text
Recusar documento

Motivo
[ Documento vencido ▼ ]

Comentário
[ O arquivo enviado venceu em 30/08/2026. ]

[x] Solicitar novamente

                         [Cancelar] [Recusar documento]
```

---

# 12. WF10 — Request Detail

```text
CND Municipal
Padaria Central Ltda.

[Aguardando cliente]

Destinatário
financeiro@padariacentral.com.br

Enviado
31/08/2026 14:10

Prazo
10/09/2026

Responsável
Maria Silva

Mensagem
Precisamos da certidão atualizada...

──────────────────────────────────────────────────────────────

Histórico

31/08 14:10   Solicitação enviada
31/08 14:22   Link aberto

──────────────────────────────────────────────────────────────

[Copiar link] [Reenviar] [Cancelar solicitação]
```

---

# 13. WF11 — Renewal Start

```text
Renovar Alvará de Funcionamento

Padaria Central Ltda.

Versão atual
v3

Validade atual
15/09/2026

Responsável
Maria Silva

Como deseja continuar?

( ) Já tenho o novo documento
( ) Solicitar o novo documento

                                        [Cancelar] [Continuar]
```

Caminho “Já tenho”:

```text
Upload
↓
Revisão
↓
Aceite
```

Caminho “Solicitar”:

```text
Request
↓
Guest Upload
↓
Review
↓
Aceite
```

---

# 14. WF12 — Accepted New Version

```text
Alvará de Funcionamento
Padaria Central Ltda.

[Válido]

Validade
18/09/2027

Versão atual
v4

──────────────────────────────────────────────────────────────

Versões

v4   Atual         18/09/2027
v3   Substituída   15/09/2026
v2   Substituída   12/09/2025

──────────────────────────────────────────────────────────────

Histórico

Hoje
Nova versão v4 aceita.

Hoje
Versão v3 marcada como substituída.

Hoje
Nova validade confirmada: 18/09/2027.
```

---

# 15. WF13 — Documents Mobile

```text
Documentos

[Buscar...]

[Filtros]

┌──────────────────────────────┐
│ Alvará de Funcionamento      │
│ Padaria Central Ltda.        │
│                              │
│ Vence em 15 dias             │
│ 15/09/2026                   │
│                              │
│ Responsável                  │
│ Maria Silva                  │
│                              │
│ [Abrir]                      │
└──────────────────────────────┘

┌──────────────────────────────┐
│ CND Federal                  │
│ ACME Ltda.                   │
│                              │
│ Válido                       │
│ 20/12/2026                   │
│                              │
│ [Abrir]                      │
└──────────────────────────────┘

                  [+]
```

---

# 16. WF14 — Review Mobile

```text
< Voltar

CND Municipal
Padaria Central Ltda.

┌──────────────────────────────┐
│                              │
│         PREVIEW              │
│                              │
│     [Abrir tela inteira]     │
└──────────────────────────────┘

Dados identificados

Emissão
01/09/2026
[Sugerido]

Validade
30/11/2026
[Sugerido]

───────────────

[Recusar]

[Aceitar documento]
```

Ações críticas não dependem de hover.

---

# 17. WF15 — Documents Empty State

```text
Documentos

┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                Nenhum documento cadastrado                   │
│                                                              │
│ Centralize documentos importantes e acompanhe               │
│ validade, responsáveis e histórico.                          │
│                                                              │
│                 [Adicionar documento]                        │
│                                                              │
│                  [Solicitar documento]                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

# 18. WF16 — Requirement Missing State

```text
CND Municipal

[Ausente]

Este requisito ainda não possui um documento válido associado.

Subject
Padaria Central Ltda.

Responsável
Maria Silva

[Adicionar documento]

[Solicitar ao cliente]
```

---

# 19. WF17 — Upload Processing / AI

```text
alvara-padaria.pdf

Processando documento...

[██████████████░░░░░]

Estamos tentando identificar:
• tipo de documento
• emissão
• validade
• órgão emissor

Você poderá revisar tudo antes de salvar.
```

Se falhar:

```text
Não conseguimos identificar automaticamente os dados.

Você pode continuar preenchendo as informações manualmente.

[Continuar]
```

---

# 20. WF18 — Unknown Outcome

Exemplo após mutação:

```text
Não foi possível confirmar o resultado

A conexão foi interrompida enquanto o documento estava sendo aceito.

Antes de tentar novamente, verifique a situação atual para evitar duplicidade.

[Verificar situação]
```

Não oferecer “Tentar novamente” cegamente como primeira ação.

---

# 21. Fluxo ponta a ponta

```text
WF04 Requirement ausente
        ↓
WF05 Solicitar documento
        ↓
WF06 Guest Upload
        ↓
WF07 Guest Confirmation
        ↓
WF08 Review Queue
        ↓
WF09 Review Detail
        ↓
Aceitar
        ↓
WF02 Document Detail
        ↓
Vencendo
        ↓
WF11 Renewal
        ↓
WF09 Review / Upload
        ↓
WF12 Nova versão aceita
```

---

# 22. Decisões de layout

## Desktop

Priorizar:

```text
tabela
split view
toolbar
contexto visível
```

## Mobile

Priorizar:

```text
cards
single-column
preview full-screen
drawers para filtros
ações primárias persistentes
```

---

# 23. Regras visuais a preservar

De acordo com “Operational Calm”:

- baixa saturação geral;
- roxo reservado para identidade/ação;
- status sem depender apenas de cor;
- bordas discretas;
- sombras mínimas;
- radius consistente;
- densidade controlada;
- tipografia clara;
- nenhuma “explosão” de badges.

---

# 24. O que deve ser validado antes de alta fidelidade

1. O usuário entende Documents vs Requirements?
2. “Nova versão” é compreensível?
3. Guest Upload é simples o bastante?
4. Received != Accepted está evidente?
5. Suggested != Confirmed está evidente?
6. Renewal parece continuação natural?
7. O usuário encontra “Solicitar documento” facilmente?
8. A Review Queue ajuda trabalho em lote?
9. O Document Detail mostra informação demais?
10. Mobile mantém tarefas críticas?

---

# 25. Resultado esperado

Se esses wireframes forem aprovados, o próximo nível visual pode aplicar os tokens e componentes finais do Design System sem redesenhar a estrutura funcional.

O objetivo desta fase é evitar investir em alta fidelidade antes de resolver:

```text
estrutura
hierarquia
fluxo
estado
contexto
```
