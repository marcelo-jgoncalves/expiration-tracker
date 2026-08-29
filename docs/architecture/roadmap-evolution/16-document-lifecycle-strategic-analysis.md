# Expiration Tracker — Evolução Estratégica para Gestão do Ciclo de Vida de Documentos

**Data:** 2026-08-29  
**Status:** Análise estratégica e arquitetural  
**Objetivo:** avaliar a evolução incremental do Expiration Tracker de um sistema de controle de vencimentos para uma plataforma enxuta de gestão do ciclo de vida documental.

---

# 1. Conclusão executiva

A evolução proposta é **coerente, plausível e estrategicamente interessante**.

A tese principal é:

> **O Expiration Tracker pode evoluir de “controle de vencimentos” para “gestão enxuta do ciclo de vida documental”.**

Essa evolução não parece artificial. Pelo contrário, boa parte da infraestrutura necessária já existe direta ou indiretamente no projeto atual.

Avaliação resumida:

| Dimensão | Avaliação |
|---|---:|
| Coerência com o domínio atual | **9/10** |
| Reaproveitamento da arquitetura existente | **9/10** |
| Potencial de aumento de valor percebido | **9/10** |
| Risco de overengineering | **alto se tudo for antecipado** |
| Arquivamento/versionamento | **evolução natural** |
| Assinatura eletrônica | **coerente, mas novo bounded context** |
| Necessidade de refatoração de domínio | **moderada/alta** |
| Compatibilidade com micro-SaaS | **boa, se modular e incremental** |

A principal recomendação é:

> **aprovar agora a direção estratégica, mas não transformar a expansão inteira em escopo imediato.**

O foco corrente deve continuar sendo:

```text
Consolidation + Pilot Readiness
↓
Controlled Pilot
↓
Product Validation
```

A expansão documental deve vir depois, de forma incremental e condicionada a validação real de produto.

---

# 2. O que já está implicitamente preparado pela arquitetura atual

O projeto atual já possui grande parte da infraestrutura necessária para uma plataforma documental enxuta.

Hoje já existem capacidades relacionadas a:

- documentos;
- armazenamento em S3;
- upload por URL presignada;
- quarantine;
- malware scanning;
- OCR/Textract;
- Bedrock;
- extração de campos;
- `DocumentSubmission`;
- guest flows;
- auditoria;
- tenant isolation;
- retenção;
- purge;
- workflows assíncronos;
- OCC;
- idempotência;
- notificações;
- quotas;
- feature flags.

Portanto:

> **o produto já construiu boa parte da infraestrutura difícil de uma plataforma documental antes de decidir explicitamente evoluir nessa direção.**

Isso torna a expansão particularmente plausível.

---

# 3. A principal mudança arquitetural futura

Hoje o modelo conceitual é próximo de:

```text
ExpirationItem
    └── Document
```

Ou seja, `Document` existe principalmente como evidência ligada a um vencimento.

Esse modelo é adequado para o produto atual, mas uma biblioteca documental exige outra relação.

Um documento pode existir sem necessariamente estar subordinado a um vencimento.

Exemplos:

```text
Contrato social
Procuração
Contrato de prestação
Apólice
Certificado
Licença
```

Portanto, a principal mudança futura deverá ser:

> **Document deixa de ser apenas filho de ExpirationItem e passa a representar um conceito de negócio autônomo.**

Essa mudança deve ser tratada como decisão arquitetural Type 1.

Ela merece ADR e protocolo Claude↔Codex antes da implementação.

---

# 4. Document e DocumentVersion devem ser conceitos distintos

Este é um dos pontos mais importantes da evolução.

O `version` atual do projeto já possui significado técnico relacionado a:

- OCC;
- concorrência;
- idempotência;
- pipelines de extração.

Portanto, não deve ser reutilizado para representar versão empresarial de documento.

O modelo conceitual recomendado é:

```text
Document
│
├── identidade lógica
├── título
├── tipo
├── subjectId?
├── currentVersionId
└── status
      │
      ├── DocumentVersion #1
      │      ├── artifact
      │      ├── hash
      │      ├── createdAt
      │      ├── createdBy
      │      ├── validade relacionada
      │      └── signatures/evidence
      │
      ├── DocumentVersion #2
      │
      └── DocumentVersion #3
```

Semântica:

```text
Document
= "este contrato"

DocumentVersion
= "esta representação específica e imutável deste contrato"
```

Esse modelo é especialmente importante para:

- renovação;
- assinatura;
- histórico;
- auditoria;
- integridade.

---

# 5. O estado técnico do artefato não deve virar estado empresarial do documento

Hoje os estados existentes de `Document` são predominantemente técnicos:

```text
PENDING_UPLOAD
SCANNING
CLEAN
REJECTED
UNSUPPORTED
TIMEOUT
DELETED
```

Eles descrevem principalmente:

- upload;
- scan;
- segurança do arquivo;
- processamento.

No futuro, o `Document` lógico pode precisar de estados empresariais como:

```text
ACTIVE
SUPERSEDED
ARCHIVED
DELETED
```

Enquanto o artefato/document version continua usando estados técnicos como:

```text
UPLOADING
SCANNING
CLEAN
REJECTED
...
```

Isso preserva uma regra fundamental já existente:

> **CLEAN significa que o arquivo foi considerado seguro, não que o documento foi aprovado do ponto de vista de negócio.**

---

# 6. Arquivamento deve permanecer dentro de Documents inicialmente

Não há necessidade de criar agora um bounded context `Archive`.

Modelo recomendado inicialmente:

```text
Documents
    ├── Document
    ├── DocumentVersion
    ├── DocumentArtifact
    └── retention/archive policies
```

Na infraestrutura:

```text
ObjectStorage
    └── S3
```

Portanto:

> **arquivamento deve ser uma capability do domínio Documents, não um domínio separado.**

Um bounded context de `Archive` ou `Records Management` só faria sentido futuramente caso o produto evoluísse para recursos como:

- tabelas formais de temporalidade;
- legal hold avançado;
- disposition review;
- classificação documental regulatória;
- WORM;
- S3 Object Lock;
- políticas formais de records management.

Criar isso agora seria overengineering.

---

# 7. Signature deve ser bounded context próprio

Ao contrário de Archive, assinatura eletrônica possui regras suficientes para justificar um bounded context próprio.

Estrutura conceitual:

```text
src/modules/signature/
    domain/
    application/
    ports/
    persistence/
    providers/
```

Não é recomendável transformar `Document` em um objeto contendo diretamente:

```text
signer
signatureStatus
signatureIp
otp
consent
evidence
...
```

Isso criaria um aggregate excessivamente monolítico.

Assinatura possui state machine própria.

Exemplo:

```text
DRAFT
   ↓
PENDING
   ↓
SENT
   ↓
VIEWED
   ↓
AUTHENTICATED
   ↓
SIGNED
```

Estados terminais/alternativos:

```text
DECLINED
EXPIRED
CANCELLED
FAILED
```

Conceitos possíveis:

```text
SignatureEnvelope
Signer
SigningSession
AuthenticationChallenge
SignatureEvent
SignatureEvidence
```

Os nomes definitivos devem ser decididos quando o desenho detalhado for necessário.

---

# 8. Assinatura deve apontar para DocumentVersion, não Document

Essa deve ser uma invariante central.

Modelo:

```text
Document
   │
   └── DocumentVersion #3
              │
              └── SignatureEnvelope
```

Ao iniciar assinatura:

```text
SHA-256(document version bytes)
        ↓
freeze
        ↓
signature workflow
```

Depois que uma versão entra em processo de assinatura, seu conteúdo não deve poder mudar.

Se o conteúdo mudar:

```text
DocumentVersion #4
```

e um novo processo de assinatura deve ser iniciado.

---

# 9. SignatureEvidence e AuditEvent são conceitos relacionados, mas distintos

O projeto já possui auditoria forte.

Mesmo assim:

```text
AuditEvent
≠
SignatureEvidence
```

`AuditEvent` registra acontecimentos operacionais do sistema.

`SignatureEvidence` precisa representar o pacote específico de evidências do processo de assinatura.

Exemplo:

```text
SignatureEvidence
    documentHash
    signerIdentity
    authenticationMethod
    challengeId
    signedAt
    IP
    userAgent
    consentTextVersion
    signaturePolicyVersion
    eventManifest
    finalArtifactHash
```

Determinados acontecimentos podem gerar simultaneamente:

```text
SignatureEvidence
+
AuditEvent
```

Mas as responsabilidades devem permanecer separadas.

---

# 10. Assinatura própria é plausível, mas não deve ser compromisso agora

Uma implementação própria baseada em:

- identificação;
- link único;
- autenticação;
- OTP;
- consentimento explícito;
- hash;
- data/hora;
- IP;
- user-agent;
- audit trail;
- evidence package;

é tecnicamente plausível.

Porém, não é recomendável registrar agora uma decisão definitiva como:

> "Expiration Tracker implementará assinatura avançada própria."

A estratégia correta é criar futuramente uma capability abstrata:

```text
Signature
   │
   ├── NativeSignatureProvider
   ├── ExternalSignatureProvider
   └── QualifiedSignatureProvider
```

Não é necessário implementar todos.

O objetivo é apenas não acoplar o bounded context ao primeiro provider escolhido.

Quando chegar o momento, deverá ser criado um ADR específico:

```text
ADR — Signature Trust & Provider Strategy
```

Alternativas:

```text
A — assinatura própria
B — provider externo
C — modelo híbrido
```

Essa decisão deve ser tomada com base em:

- demanda real;
- risco;
- custo;
- requisitos jurídicos;
- experiência desejada;
- nicho inicial.

---

# 11. Renewal deve ser um conceito antes de virar aggregate

Hoje o produto já possui comportamento de renovação.

Enquanto a renovação significar apenas:

```text
vencimento antigo
→ novo ciclo
```

não é necessário criar um aggregate `Renewal`.

Mas, quando o fluxo evoluir para:

```text
renovação iniciada
→ documento solicitado
→ documento recebido
→ revisão
→ assinatura solicitada
→ assinatura pendente
→ assinado
→ nova versão ativada
→ novo vencimento
```

passa a existir justificativa real para um aggregate próprio, por exemplo:

```text
RenewalCase
```

Portanto:

```text
conceito de Renewal agora
→ SIM

aggregate Renewal agora
→ NÃO
```

---

# 12. Não criar Client/Party paralelo a TrackedSubject

O domínio atual já possui `TrackedSubject` horizontal.

Ele pode representar tipos como:

```text
COMPANY
VENDOR
CLIENT
EMPLOYEE
ASSET
LOCATION
CUSTOM
```

Portanto, não é recomendável criar uma nova entidade genérica paralela chamada:

```text
Client
Party
Counterparty
```

O modelo futuro deve reutilizar `TrackedSubject`.

Exemplo:

```text
Tenant / Organization
│
├── TrackedSubject
│
├── Document
│      └── DocumentVersion*
│
├── ExpirationItem
│
├── RenewalCase*
│
├── SignatureEnvelope*
│      ├── Signer*
│      └── SignatureEvidence*
│
├── RequirementAssignment
│
├── Notification*
│
└── AuditEvent*
```

Relações possíveis:

```text
Document → TrackedSubject?          optional

ExpirationItem → DocumentVersion?   optional

SignatureEnvelope → DocumentVersion required

RenewalCase → source DocumentVersion?
            → target DocumentVersion?
            → old ExpirationItem?
            → new ExpirationItem?
```

É fundamental preservar:

> **ExpirationItem pode continuar existindo sem documento.**

---

# 13. Arquivamento deve ser implementado já com modelo versionável

A ordem de entrega pode ser:

```text
arquivo
→ versionamento
```

Mas o desenho do modelo não deve seguir essa mesma ordem.

Recomendação:

```text
DESIGN:
Document + DocumentVersion

IMPLEMENTATION SLICE 1:
Document Archive

IMPLEMENTATION SLICE 2:
Version History
```

Isso evita implementar uma biblioteca documental que precise ser remodelada imediatamente depois.

---

# 14. Ordem recomendada de evolução

## Fase 0 — Agora

Não implementar a expansão.

Registrar apenas a direção estratégica:

```text
Document Lifecycle Management
— Future Product Evolution
```

O foco continua sendo Pilot Readiness.

---

## Fase 1 — Controlled Pilot

Validar o núcleo atual:

```text
Expirations
Reminders
Documents
Requirements
Guest flow
```

Nenhuma capability futura deve virar blocker.

---

## Fase 2 — Document Lifecycle Foundation

Criar ADR para:

```text
Document
DocumentVersion
DocumentArtifact
```

Além disso, revisar access patterns do DynamoDB.

---

## Fase 3 — Document Archive

Entregar:

```text
upload
download
metadata
subject association
history
hash
audit
retention
access control
```

---

## Fase 4 — Version History

Representar:

```text
Document
  V1
  V2
  V3
```

Com:

- current version;
- superseded versions;
- histórico.

---

## Fase 5 — Renewal Workflow

Adicionar `RenewalCase` somente se usuários reais justificarem a necessidade de um workflow persistente.

---

## Fase 6 — Signature Capability

Criar bounded context próprio.

Antes de implementar, decidir:

```text
native
external provider
hybrid
```

---

## Fase 7 — Premium Communication Channels

SMS e WhatsApp devem ser tratados como trilha paralela.

Eles não dependem da implementação de assinatura.

Caso clientes demonstrem maior disposição a pagar por alertas multicanal, essa trilha pode subir de prioridade.

---

## Fase 8 — Qualified Signature Integrations

Somente mediante demanda real:

```text
ICP-Brasil
provider especializado
ou outra solução juridicamente adequada
```

---

# 15. O impacto principal no DynamoDB será de access patterns

A maior mudança técnica não será simplesmente armazenar mais arquivos.

Hoje o `Document` está fortemente ligado ao `ExpirationItem`.

Uma biblioteca documental exigirá consultas como:

```text
documents by tenant
documents by subject
documents by status
documents by type
recent documents
versions of document
```

Isso cria novos access patterns.

Portanto:

> **a evolução documental deve passar por revisão formal do single-table design antes de implementação.**

Questões futuras:

```text
Document vira aggregate próprio?
novo GSI?
coleção por tenant?
relações com TrackedSubject?
```

Não existe razão, neste momento, para abandonar DynamoDB.

O problema é modelagem de acesso, não tecnologia.

---

# 16. Multi-tenancy

A expansão deve ser implementada sem reforçar a hipótese histórica:

```text
tenantId = userId
```

O modelo futuro continua sendo:

```text
tenantId = organizationId
```

Portanto:

```text
Document.owner = tenant
```

e não:

```text
Document.owner = user
```

O usuário deve aparecer como ator:

```text
createdBy
uploadedBy
signedBy
```

Isso facilitará a futura evolução para:

```text
Organization
Membership
RBAC
Tenant Admin
```

---

# 17. Signer não precisa ser usuário do tenant

Um signatário pode ser:

- cliente;
- fornecedor;
- funcionário;
- representante externo;
- proprietário;
- terceiro.

Portanto:

```text
Signer ≠ Membership
```

necessariamente.

A arquitetura atual de guest flows oferece bons padrões de segurança que podem ser reutilizados conceitualmente:

- token opaco;
- HMAC;
- rate limiting;
- anti-enumeration;
- autorização limitada.

Mas não se deve reutilizar diretamente a mesma entidade de guest upload.

O bounded context `signature` deve ter sua própria autorização externa.

---

# 18. Impacto em LGPD

Arquivamento aumenta significativamente a superfície de dados.

O produto passa de:

```text
documento necessário ao vencimento atual
```

para:

```text
histórico potencialmente duradouro de versões
```

Com assinatura surgem ainda:

```text
IP
user-agent
identity evidence
authentication attempts
consent
signature evidence
```

Será necessário revisar futuramente:

```text
data map
retention class
DSR/export
purge
legal hold
incident response
subprocessors
```

A disciplina já criada para W3-07 torna-se ainda mais importante.

---

# 19. Object Lock/WORM deve ser adiado

É tentador usar:

```text
S3 Object Lock
```

para documentos assinados.

Mas isso pode criar conflito com:

- DSR;
- retenção;
- legal hold;
- políticas regulatórias;
- custo operacional.

Portanto, inicialmente:

```text
hash
+
version control
+
authorization
+
audit
+
controlled deletion
```

já oferece uma base forte.

Object Lock deve ser ADR futuro, caso exista necessidade real.

---

# 20. Impacto em planos comerciais

A arquitetura atual de entitlements e quotas oferece boa base para monetização.

Possível direção:

## Free / Basic

```text
vencimentos
email
poucos documentos
storage reduzido
histórico limitado
```

## Pro

```text
mais armazenamento
versionamento completo
arquivo documental
audit trail
múltiplos responsáveis
```

## Premium

```text
signature envelopes
signature evidence
SMS
WhatsApp
advanced retention
audit export
```

Mas o código não deve depender de:

```text
plan === "premium"
```

O correto é trabalhar com capabilities:

```text
canUseSignatures
maxStoredBytes
maxDocumentVersions
monthlySignatureEnvelopes
canUseSms
canUseWhatsapp
```

Isso mantém liberdade comercial.

---

# 21. ADRs recomendados agora

## ADR 1 — Product Domain Evolution

Registrar formalmente:

> Expiration Tracker poderá evoluir incrementalmente para Document Lifecycle Management, preservando Expiration como capability independente.

Sem definir schema.

Sem implementar.

---

# 22. ADR recomendado quando a implementação de arquivo estiver próxima

## ADR 2 — Document Identity Model

Definir:

```text
Document
DocumentVersion
DocumentArtifact
Expiration relationship
TrackedSubject relationship
```

Além de:

- access patterns;
- single-table strategy;
- migração do modelo atual;
- compatibilidade.

Esse ADR deve passar por Claude↔Codex.

---

# 23. Decisões que devem ser deliberadamente adiadas

Não decidir agora:

```text
Signature provider
native signature algorithm
OTP mechanism
advanced/simple legal classification
PDF signing format
ICP-Brasil provider
S3 Object Lock
RenewalCase state machine
document classification taxonomy
archive folder hierarchy
storage pricing
final plan names/prices
```

Essas decisões dependem de dados que o projeto ainda não possui.

Antecipá-las seria overengineering.

---

# 24. Não criar sistema de pastas agora

Evitar criar desde já:

```text
folder
subfolder
folder permissions
inheritance
sharing
moving
copying
```

Isso colocaria o produto no caminho de recriar:

```text
Google Drive
SharePoint
DMS genérico
```

Inicialmente bastam conceitos como:

```text
TrackedSubject
DocumentType
category
tags
status
search
```

Pastas só devem existir se clientes reais demonstrarem necessidade.

---

# 25. Posicionamento comercial

O produto atual resolve:

> **Não esqueça quando documentos vencem.**

A evolução proposta permite posicionar o produto como:

> **Tenha controle sobre documentos importantes durante todo o ciclo de vida.**

Exemplo:

```text
Contrato
↓
recebido/criado
↓
assinado
↓
arquivado
↓
vigente
↓
alerta
↓
renovação
↓
nova assinatura
↓
nova versão
↓
histórico
```

Essa proposta aumenta bastante o valor percebido sem obrigar o produto a competir diretamente com sistemas genéricos de assinatura ou DMS.

---

# 26. Nicho contábil

O nicho contábil encaixa muito bem na arquitetura horizontal proposta.

Exemplo:

```text
Cliente
│
├── certificado
├── procuração
├── contrato
├── licenças
└── documentos periódicos
         ↓
validade
         ↓
alerta
         ↓
solicitação
         ↓
renovação
         ↓
assinatura
         ↓
nova versão
```

Não é necessário criar uma entidade `Client`.

Pode-se usar:

```text
TrackedSubject(type=CLIENT)
```

A mesma arquitetura pode atender:

- contabilidade;
- SST;
- condomínios;
- consultorias;
- imobiliárias;
- gestão de fornecedores.

Isso preserva a horizontalidade do domínio.

---

# 27. Roadmap estratégico recomendado

```text
CURRENT
Consolidation + Pilot Readiness
        ↓
Controlled Pilot
        ↓
Product Validation
        ↓
Document Lifecycle Foundation
        ↓
Document Archive
        ↓
Document Version History
        ↓
Renewal Workflow (if validated)
        ↓
Signature Capability
        ↓
Premium Communication Channels
        ↓
Qualified Signature Integrations (if demanded)
```

Importante:

> **SMS/WhatsApp é uma trilha comercial paralela e pode subir de prioridade antes de assinatura se clientes demonstrarem maior disposição a pagar por ela.**

---

# 28. Decisão estratégica recomendada agora

A recomendação é aprovar formalmente apenas a direção.

Texto conceitual sugerido:

> **O Expiration Tracker poderá evoluir incrementalmente para uma plataforma enxuta de Document Lifecycle Management. Essa evolução preservará Expiration como capability independente, reutilizará TrackedSubject como entidade horizontal, introduzirá DocumentVersion como conceito distinto de OCC versioning e tratará Signature como bounded context opcional. Nenhuma dessas capacidades é blocker do piloto atual e sua implementação será condicionada a validação de produto.**

Esse é o nível correto de compromisso neste momento.

---

# 29. Decisão recomendada por conceito

| Conceito | Decisão |
|---|---|
| **Document** | tornar futuramente um conceito lógico autônomo |
| **DocumentVersion** | **sim, essencial** |
| **DocumentArtifact** | útil para separar bytes/processamento de negócio |
| **ExpirationItem** | manter independente |
| **TrackedSubject** | reutilizar; não criar Client/Party |
| **RenewalCase** | adiar até haver workflow persistente real |
| **Signature** | **bounded context próprio** |
| **SignatureEvidence** | próprio de Signature, não apenas AuditEvent |
| **Archive** | capability de Documents inicialmente |
| **Storage** | infraestrutura/port, não bounded context |
| **Audit** | cross-cutting; não substituir evidence |
| **Object Lock/WORM** | adiar |
| **ICP-Brasil** | integração futura sob demanda |
| **assinatura própria** | manter como opção, não compromisso agora |

---

# 30. Conclusão final

A evolução estratégica deve ser **aprovada**.

Ela é tecnicamente coerente com o que já existe e aproveita investimentos importantes feitos pelo projeto:

- documentos;
- S3;
- malware scanning;
- OCR;
- guest flows;
- tenant isolation;
- purge;
- auditoria;
- notificações;
- quotas;
- workflows assíncronos.

A principal mudança arquitetural futura não é assinatura.

É:

> **deixar de tratar Document apenas como evidência subordinada a ExpirationItem e introduzir corretamente Document lógico + DocumentVersion imutável.**

Se essa fundação for bem desenhada:

```text
arquivamento
→ natural

versionamento
→ natural

renovação
→ modelável

assinatura
→ bounded context modular
```

A recomendação é manter a disciplina atual do projeto:

> **registrar a visão agora, validar o produto atual primeiro e promover cada capability de roadmap para arquitetura somente quando houver motivo real para construí-la.**
