# Expiration Tracker — Especificação Funcional Inicial do Domínio Documental

**Data:** 31 de agosto de 2026  
**Status:** PROPOSTA FUNCIONAL v0.1  
**Escopo:** objetos de produto, estados, relações, jornadas e superfícies.  
**Fora de escopo:** arquitetura técnica, banco de dados, AWS, APIs, filas, armazenamento físico e segurança de implementação.

## 1. Objetivo

Definir formalmente como o domínio documental deve funcionar dentro do Expiration Tracker.

O objetivo não é criar um GED genérico, mas suportar:

```text
obrigação
+
documento
+
validade
+
responsável
+
solicitação
+
renovação
+
histórico
```

## 2. Linguagem funcional canônica

### Organization
Espaço B2B ao qual pertencem os dados.

### Subject
Entidade acompanhada pelo Expiration Tracker: empresa cliente, fornecedor, colaborador, equipamento, ativo, imóvel, unidade etc.

### Document Type
Classificação funcional: Alvará, CND Federal, Contrato Social, Apólice, Procuração etc.

### Document
Identidade lógica e contínua de um documento ao longo do tempo.

Exemplo: **Alvará de Funcionamento da Padaria Central**.

### Document Version
Ocorrência concreta/versão daquele Document.

### Document File
Arquivo digital pertencente a uma Document Version. Uma versão pode possuir um ou mais arquivos.

### Requirement
Necessidade documental que deve ser satisfeita.

Exemplo: **Fornecedor precisa manter CND Federal válida**.

### Requirement Template
Conjunto reutilizável de Requirements.

### Document Request
Solicitação enviada para obtenção de um documento.

### Document Review
Avaliação humana de versão recebida.

### Expiration
Validade monitorável associada a uma versão aceita.

### Renewal
Processo de substituição da versão atual por nova versão válida.

## 3. Relações principais

```text
Organization
    ↓
Subject
    ↓
Document
    ↓
Document Version
    ↓
Document File
```

Também:

```text
Requirement
    ↓
é satisfeito por
    ↓
Document / Document Version
```

```text
Document Request
    ↓
pode resultar em
    ↓
Document Version
```

```text
Document Version
    ↓
pode possuir
    ↓
Expiration
```

## 4. Regra central de identidade

`Document` representa continuidade de negócio. `Document Version` representa uma versão concreta dessa continuidade.

Correto:

```text
Document: Alvará / Padaria Central
Version 1: 2025
Version 2: 2026
Version 3: 2027
```

Evitar criar documentos totalmente desconectados para cada renovação da mesma obrigação.

## 5. Tipos funcionais de documento

### Expirable Document
Possui validade e participa do tracking.

### Permanent Document
Não possui expiração normal.

### Conditional Document
Pode possuir validade dependendo do conteúdo/contexto, como procuração, contrato ou autorização.

A interface deve permitir indicar explicitamente se o documento possui validade.

## 6. Estado do Document

Estados de alto nível:

```text
ACTIVE
ARCHIVED
```

Não usar estado do Document para representar validade ou revisão.

## 7. Estado da Document Version

```text
DRAFT
RECEIVED
UNDER_REVIEW
ACCEPTED
REJECTED
SUPERSEDED
```

- `DRAFT`: criada internamente, ainda não definitiva;
- `RECEIVED`: arquivo recebido;
- `UNDER_REVIEW`: em revisão;
- `ACCEPTED`: versão aceita operacionalmente;
- `REJECTED`: recusada;
- `SUPERSEDED`: versão aceita anteriormente e substituída.

## 8. Regra da versão atual

Um Document deve possuir no máximo uma versão `ACCEPTED` como versão atual.

Ao aceitar nova versão:

```text
versão anterior
ACCEPTED → SUPERSEDED

nova versão
→ ACCEPTED
```

## 9. Estados de validade

Validade é uma dimensão própria:

```text
NOT_APPLICABLE
VALID
EXPIRING
EXPIRED
UNKNOWN
```

- `NOT_APPLICABLE`: permanente;
- `VALID`: válido;
- `EXPIRING`: dentro da janela de atenção;
- `EXPIRED`: vencido;
- `UNKNOWN`: aplicável, mas não confirmada.

## 10. Estados do Requirement

```text
MISSING
PENDING
SATISFIED
EXPIRING
NOT_SATISFIED
NOT_APPLICABLE
```

- `MISSING`: nenhum documento adequado;
- `PENDING`: processo em andamento;
- `SATISFIED`: documento aceito e válido/permanente;
- `EXPIRING`: documento aceito perto do vencimento;
- `NOT_SATISFIED`: inválido, vencido ou rejeitado;
- `NOT_APPLICABLE`: exceção para aquele Subject.

## 11. Estados do Document Request

```text
DRAFT
SENT
OPENED
SUBMITTED
UNDER_REVIEW
COMPLETED
REJECTED
CANCELLED
EXPIRED
```

Nem todos precisam ser expostos visualmente se isso prejudicar simplicidade.

## 12. Document Review

A revisão permite:

```text
ACEITAR
RECUSAR
```

Na recusa:

- motivo;
- comentário opcional;
- opção `Solicitar novamente`.

Motivos padronizáveis:

- documento vencido;
- arquivo ilegível;
- documento incorreto;
- empresa incorreta;
- documento incompleto;
- versão antiga;
- outro.

## 13. Origem da versão

Toda versão deve registrar origem funcional, por exemplo:

```text
MANUAL_UPLOAD
GUEST_UPLOAD
REQUEST_RESPONSE
IMPORT
AUTOMATED_CAPTURE
```

## 14. Metadados mínimos do Document

- título;
- Document Type;
- Subject;
- categoria;
- responsável;
- possui validade?;
- observações;
- ativo/arquivado.

## 15. Metadados mínimos da Document Version

- ordem da versão;
- data de recebimento;
- data de emissão, quando aplicável;
- validade inicial/final;
- estado de revisão;
- origem;
- arquivos;
- observações;
- quem enviou;
- quem confirmou;
- data da confirmação.

## 16. IA / extração assistida

A IA pode sugerir:

- tipo documental;
- Subject;
- empresa;
- número do documento;
- órgão emissor;
- data de emissão;
- validade;
- campos relevantes.

Cada sugestão deve estar explicitamente em um estado como:

```text
SUGGESTED
CONFIRMED
CORRECTED
REJECTED
```

Não deve existir confirmação silenciosa.

## 17. Jornada A — upload de novo documento

```text
Selecionar Subject
        ↓
Novo documento
        ↓
Upload
        ↓
Escolher/confirmar tipo
        ↓
Extração sugere dados
        ↓
Usuário revisa
        ↓
Confirma
        ↓
Document criado
        ↓
Version aceita
        ↓
Expiration criada se aplicável
```

## 18. Jornada B — nova versão

```text
Abrir Document
        ↓
Adicionar nova versão
        ↓
Upload
        ↓
Extração
        ↓
Revisão
        ↓
Aceitar
        ↓
Versão anterior → SUPERSEDED
Nova versão → ACCEPTED
        ↓
Novo ciclo de validade
```

## 19. Jornada C — solicitação externa

```text
Criar Document Request
        ↓
Definir documento esperado
        ↓
Escolher destinatário
        ↓
Enviar link
        ↓
Destinatário envia arquivo
        ↓
Version = RECEIVED
        ↓
Revisão interna
        ↓
Aceitar ou recusar
```

## 20. Jornada D — recusa

```text
Version recebida
        ↓
Recusar
        ↓
Selecionar motivo
        ↓
Version = REJECTED
        ↓
Requirement continua não satisfeito
        ↓
[Solicitar novamente]
```

## 21. Jornada E — renovação

```text
Document próximo do vencimento
        ↓
Iniciar renovação
        ↓
Criar ação / solicitação
        ↓
Novo arquivo obtido
        ↓
Nova Document Version
        ↓
Revisão
        ↓
Aceite
        ↓
Versão anterior superseded
        ↓
Nova validade
```

## 22. Jornada F — documento permanente

```text
Novo Document
        ↓
Tipo permanente
        ↓
Upload
        ↓
Revisão
        ↓
Aceite
        ↓
Validity = NOT_APPLICABLE
```

## 23. Jornada G — Requirement

```text
Requirement Template
        ↓
Aplicado ao Subject
        ↓
Requirement criado
        ↓
Busca documento compatível
        ↓
se ausente: MISSING
        ↓
solicitação / upload
        ↓
aceite
        ↓
SATISFIED
```

## 24. Subject arquivado

Ao arquivar Subject:

- documentos permanecem;
- versões permanecem;
- histórico permanece;
- novas ações podem ser restringidas;
- vencimentos podem deixar de gerar ações conforme política futura.

O histórico não deve ser perdido por arquivamento.

## 25. Superfície — Documents Collection

Objetivo: mostrar o estado documental operacional da Organization.

Colunas iniciais:

- Documento;
- Subject;
- Tipo;
- Validade;
- Status;
- Responsável;
- Última atualização.

Filtros:

- Subject;
- tipo;
- responsável;
- válido;
- vencendo;
- vencido;
- permanente;
- aguardando revisão;
- arquivado.

## 26. Superfície — Document Detail

### Cabeçalho

- nome;
- Subject;
- situação;
- validade;
- responsável;
- ações.

### Versão atual

- preview;
- metadados;
- validade;
- arquivos;
- origem.

### Versões
Histórico completo.

### Atividade
Timeline compreensível.

### Relacionados

- Requirement;
- Expiration;
- Request;
- Renewal.

## 27. Superfície — Subject / Documents

```text
Documentos
12 total
8 válidos
2 vencendo
1 vencido
1 permanente
```

## 28. Superfície — Requirements

| Requirement | Status | Documento | Validade |
|---|---|---|---|
| CND Federal | Satisfeito | CND Federal | 30/01/27 |
| Alvará | Vencendo | Alvará | 15/09/26 |
| CND Municipal | Ausente | — | — |

## 29. Superfície — Requests

Lista com:

- documento solicitado;
- Subject;
- destinatário;
- status;
- enviado em;
- prazo;
- responsável interno.

Ações:

- reenviar;
- cancelar;
- abrir;
- revisar;
- solicitar novamente.

## 30. Superfície — Review Queue

```text
5 documentos aguardando revisão
```

Cada item mostra:

- Subject;
- documento esperado;
- arquivo;
- quem enviou;
- data;
- sugestões extraídas.

Ações:

```text
Aceitar
Recusar
Abrir detalhes
```

## 31. Superfície — Dashboard

Cards úteis:

- vencidos;
- vencendo;
- ausentes;
- aguardando cliente;
- aguardando revisão;
- renovações abertas.

Evitar tratar “GB usados” como valor central.

## 32. Ações principais

- criar documento;
- adicionar versão;
- anexar arquivo complementar;
- confirmar metadados;
- atribuir responsável;
- iniciar renovação;
- solicitar documento;
- aceitar;
- recusar;
- arquivar;
- restaurar;
- baixar;
- visualizar;
- pesquisar;
- filtrar;
- exportar dossiê quando disponível.

## 33. Regras de UX

1. Não pedir dados que a extração consegue sugerir.
2. Não transformar sugestão em dado confirmado sem ação explícita.
3. Renovação sempre preserva histórico.
4. Upload deve deixar claro se é novo documento, nova versão ou complemento.
5. Erro de upload não deve apagar formulário preenchido.
6. Troca de Organization não pode misturar documentos ou estados.

## 34. Notificações funcionais

Eventos úteis:

- solicitação enviada;
- documento enviado pelo cliente;
- documento aguardando revisão;
- documento recusado;
- documento aceito;
- validade próxima;
- documento vencido;
- renovação iniciada;
- nova versão aceita.

Preferências deverão evitar excesso de notificações.

## 35. Responsabilidade

Um Document pode possuir responsável operacional. Uma Renewal pode ter responsável diferente. Requirement também pode possuir responsável.

A UI deve distinguir quando necessário:

```text
Responsável pelo documento
Responsável pela renovação
```

## 36. Recorrência

Uma Document Request poderá ser recorrente. Cada ocorrência deve criar nova solicitação, e não reciclar silenciosamente uma antiga.

## 37. Templates

Possíveis templates:

- Requirement Template;
- Request Template;
- Document Type Template.

Evitar um sistema excessivamente genérico na primeira fase.

## 38. Hipótese de planos

### Base documental — todos os planos pagos

- Document;
- Document Version;
- upload;
- preview;
- validade;
- renovação;
- histórico;
- integração com Subject;
- busca básica.

### Premium

- mais storage;
- OCR;
- IA;
- busca no conteúdo;
- requests recorrentes;
- requirements/templates avançados;
- review queue avançada;
- dossiê;
- auditoria avançada.

## 39. Métricas de uso futuras

- documentos por Organization;
- versões por Document;
- % com validade;
- % uploads com extração;
- % sugestões confirmadas;
- tempo upload → aceitação;
- requests enviados;
- taxa request → upload;
- taxa de recusa;
- tempo até renovação;
- documentos expirados;
- requirements satisfeitos;
- storage por Organization.

## 40. Perguntas abertas

1. Document deve obrigatoriamente pertencer a Subject?
2. Podemos ter Document sem Subject?
3. Requirements serão primeira classe desde a primeira versão?
4. Review será obrigatório para upload interno?
5. Quando upload interno pode ser autoaceito?
6. Quantos arquivos uma Version pode conter?
7. Complementos pertencem à mesma Version ou possuem subtipo?
8. Diferença final entre archive e delete?
9. Viewer pode baixar?
10. Guest Request precisa de prazo obrigatório?
11. Quem pode confirmar sugestão de IA?
12. Premium terá limites por GB, documentos, processamento ou combinação?

## 41. Decisões propostas para próxima rodada

### D1 — Document é entidade lógica duradoura
**Proposta:** SIM.

### D2 — Renovação cria nova Document Version
**Proposta:** SIM.

### D3 — Documentos permanentes são suportados
**Proposta:** SIM.

### D4 — Versionamento é parte do core documental
**Proposta:** SIM.

### D5 — Received e Accepted são estados distintos
**Proposta:** SIM.

### D6 — IA sugere; humano confirma
**Proposta:** SIM, salvo futura política específica baseada em confiança e tipo documental.

### D7 — Não haverá árvore arbitrária de pastas inicialmente
**Proposta:** SIM.

### D8 — Guest upload faz parte do modelo funcional
**Proposta:** SIM.

### D9 — Requirements pertencem ao desenho funcional do domínio
**Proposta:** SIM.

### D10 — Storage básico existe nos planos pagos; Premium vende capacidades avançadas
**Proposta:** SIM.

## 42. Sequência funcional recomendada

```text
Document
        ↓
Document Version
        ↓
Upload / Preview
        ↓
Validity
        ↓
Renewal
        ↓
Guest Request
        ↓
Review
        ↓
Requirements
        ↓
OCR / IA
        ↓
Search
        ↓
Recurring Requests
        ↓
Dossiê / Auditoria avançada
```

Essa é uma sequência funcional, não um plano técnico.

## 43. Critério de sucesso do domínio

O usuário deve conseguir responder rapidamente:

- Qual documento está válido hoje?
- Qual versão é a atual?
- Quem é responsável?
- O que vence em breve?
- O que está faltando?
- O que aguardamos do cliente?
- O que recebemos mas ainda não aprovamos?
- Qual era o documento anterior?
- Quando esse item foi renovado?
- Qual evidência documental sustenta esta obrigação?

## 44. Conclusão

O domínio documental deve ser tratado como extensão natural do Expiration Tracker, não como armazenamento lateral.

Modelo central:

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

com:

```text
Document Request
+
Review
+
Responsible
+
AI Assistance
```

A próxima rodada deve fechar D1–D10 e depois produzir jornadas detalhadas com critérios de aceitação antes do desenho técnico.
