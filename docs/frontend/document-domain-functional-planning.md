# Expiration Tracker — Planejamento Funcional do Arquivo Documental Operacional

**Data:** 31 de agosto de 2026  
**Status:** Planejamento funcional inicial  
**Escopo:** produto, funcionalidades e experiência; sem decisões de engenharia ou infraestrutura.

## 1. Visão

O Expiration Tracker deve evoluir de um simples controle de datas para uma plataforma de:

> **gestão de vencimentos + arquivo documental operacional + ciclo de renovação**

O armazenamento não deve funcionar como um drive genérico. Cada documento armazenado deve possuir **contexto de negócio**.

```text
Documento
    ↓
Cliente / fornecedor / ativo / pessoa
    ↓
Validade
    ↓
Responsável
    ↓
Alertas
    ↓
Renovação
    ↓
Nova versão
    ↓
Histórico
```

## 2. Princípio de produto

O módulo documental existe para responder perguntas como:

- Qual documento comprova esta obrigação?
- Esse documento ainda está válido?
- Quem é o responsável?
- Quando precisa ser renovado?
- Qual é a versão atual?
- Quais versões anteriores existiram?
- O cliente já enviou o documento solicitado?
- O documento recebido foi aceito?
- O que ainda está faltando?

Não deve competir com Google Drive, OneDrive ou GEDs genéricos.

## 3. Estrutura funcional principal

```text
Organization
    ↓
Tracked Subject
    ↓
Document
    ↓
Document Version
```

Exemplo:

```text
Padaria Central Ltda.
    ↓
Alvará de Funcionamento
    ├── versão 2025 — substituída
    ├── versão 2026 — substituída
    └── versão 2027 — atual
            ↓
       validade: 18/05/2027
       responsável: Fernanda
       alertas
       histórico
```

## 4. Documento lógico e versões

“Alvará de Funcionamento” é o **documento lógico**. Cada renovação gera uma **nova versão**, preservando arquivo anterior, datas, responsável e histórico. Um novo upload não deve apagar silenciosamente a versão anterior.

## 5. Documentos com e sem validade

### Com validade

Exemplos: alvará, certidão, licença, certificado, apólice, procuração com prazo.

```text
Documento
    ↓
Validade
    ↓
Expiration Tracking
```

### Permanente

Exemplos: contrato social, alteração societária, documento cadastral, comprovante histórico.

O sistema não deve obrigar todo documento a possuir vencimento.

## 6. Upload assistido

Experiência desejada:

```text
[Enviar documento]

alvara-padaria.pdf
        ↓
processamento
        ↓

Encontramos:
Tipo: Alvará de Funcionamento
Empresa: Padaria Central Ltda.
Emissão: 20/05/2026
Validade: 18/05/2027
Órgão: Prefeitura de Belo Horizonte

[Confirmar informações]
```

Após confirmação:

```text
arquivo armazenado
+
documento criado/atualizado
+
validade registrada
+
monitoramento iniciado
```

## 7. Integridade epistêmica

A interface deve diferenciar claramente:

```text
Validade sugerida pela IA
18/05/2027
[Confirmar]
```

de:

```text
Validade confirmada
18/05/2027
```

A IA acelera o trabalho, mas não deve transformar interpretação em verdade operacional sem confirmação apropriada.

## 8. Ficha do documento

Cada documento deve possuir uma tela própria com:

- Subject;
- situação;
- validade;
- responsável;
- arquivo atual;
- última atualização;
- próximo alerta;
- versões anteriores;
- histórico de atividades.

## 9. Renovação como workflow documental

```text
Documento vai vencer
        ↓
Iniciar renovação
        ↓
Responsável recebe ação
        ↓
Novo documento é obtido
        ↓
Upload
        ↓
Extração
        ↓
Usuário confirma
        ↓
Versão anterior → substituída
Nova versão → atual
        ↓
Nova validade
        ↓
Novo ciclo de alertas
        ↓
Histórico preservado
```

Renovar não deve ser apenas alterar uma data.

## 10. Solicitação de documento

O sistema deve permitir solicitar documentos a terceiros sem exigir conta completa.

```text
Subject
    ↓
Solicitar documento
    ↓
Tipo esperado
    ↓
Destinatário
    ↓
Link seguro
    ↓
Upload externo
    ↓
Revisão interna
```

## 11. Recebido não é aceito

Estados distintos:

```text
SOLICITADO
    ↓
RECEBIDO
    ↓
EM REVISÃO
   ↙     ↘
ACEITO   RECUSADO
```

Um arquivo recebido pode estar vencido, ilegível, incorreto, incompleto ou pertencer a outra empresa.

## 12. Recusa e nova solicitação

A recusa deve registrar motivo e permitir nova solicitação sem reconstruir o contexto.

Exemplo:

```text
Documento recusado
Motivo: Documento vencido.
[Solicitar novamente]
```

## 13. Solicitações recorrentes

Planejar pedidos recorrentes mensais, trimestrais, anuais, personalizados ou sob demanda. A capacidade entra no roadmap funcional, não necessariamente na primeira entrega.

## 14. Requisitos documentais

O produto deve representar aquilo que um Subject precisa manter.

```text
Fornecedor ACME

✓ Contrato social
✓ CND Federal
⚠ Alvará — vence em 15 dias
✕ Certidão municipal — ausente
✓ Apólice
```

Assim, o produto responde:

> **A documentação exigida deste Subject está completa e válida?**

## 15. Modelos de requisitos

Exemplos reutilizáveis:

```text
Regularidade anual
├─ CND Federal
├─ CND Estadual
├─ CND Municipal
└─ Alvará
```

```text
Abertura de empresa
├─ documentos dos sócios
├─ comprovante de endereço
├─ contrato social
└─ demais requisitos
```

## 16. Área Documentos

A navegação deve considerar “Documentos” como área de primeira classe:

```text
Visão geral
Vencimentos
Documentos
Sujeitos
Equipe
Configurações
```

A lista deve ser operacional, não um file explorer.

| Documento | Subject | Status | Validade | Responsável |
|---|---|---|---|---|
| Alvará | Padaria Central | Vence em 15 dias | 15/09/26 | Maria |
| CND Federal | ACME | Válido | 20/12/26 | João |
| Contrato social | XPTO | Permanente | — | Ana |
| Apólice | Beta | Vencido | 28/08/26 | Carlos |

## 17. Busca

A busca deve responder a necessidades de negócio:

- Alvará Padaria Central;
- CND ACME;
- documentos vencidos;
- procurações de João;
- documentos do fornecedor XPTO.

No Premium, planejar busca dentro do conteúdo OCR.

## 18. Organização sem árvore de pastas

Não criar inicialmente pastas/subpastas arbitrárias. A organização natural é:

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

Filtros, pesquisa, categorias e relações devem resolver a navegação.

## 19. Categorias

Categorias iniciais sugeridas:

- Certidão
- Licença
- Alvará
- Contrato
- Procuração
- Apólice
- Certificado
- Documento societário
- Documento cadastral
- Comprovante
- Outro

## 20. Versionamento

Versionamento é parte central do produto.

```text
CND Federal

v3 — atual
01/08/2026
vence 30/01/2027

v2 — substituída
01/02/2026
venceu 31/07/2026

v1 — substituída
02/08/2025
venceu 31/01/2026
```

## 21. Substituir vs. complementar

Ao enviar arquivo para documento existente:

```text
○ Adicionar nova versão deste documento
○ Adicionar arquivo complementar
```

Um documento lógico pode ter múltiplos arquivos associados à mesma versão.

## 22. Preview, download e histórico

Usuário autorizado deve poder visualizar PDFs/imagens, baixar arquivos e navegar entre versões. O histórico deve ser compreensível para negócio, por exemplo:

```text
22/05 — Maria enviou a versão 3
22/05 — Sistema sugeriu validade 18/05/2027
22/05 — Maria confirmou a validade
22/05 — João passou a ser responsável
```

## 23. Permissões

O módulo deve respeitar o modelo B2B da Organization. Viewer, Member, Admin e Owner terão capacidades diferentes. A matriz final deve ser alinhada ao RBAC geral; não há necessidade inicial de ACL arbitrária por pasta/documento.

## 24. Guest flow

Priorizar:

```text
Solicitação
→ Link seguro
→ Upload
→ Confirmação
```

Não criar de imediato um portal completo para terceiros. Um portal dedicado só deve surgir com evidência real de necessidade.

## 25. Subject como visão documental

Cada Subject pode possuir:

```text
Resumo
Documentos
Vencimentos
Requisitos
Histórico
```

Com resumo do tipo:

```text
12 documentos
8 válidos
2 vencendo
1 vencido
1 permanente
```

## 26. Dashboard

Indicadores úteis:

```text
12 documentos vencidos
18 vencendo em 30 dias
7 aguardando cliente
5 aguardando revisão
```

Storage consumido não deve ser o centro do dashboard.

## 27. Estados em dimensões separadas

Não criar um único status que tente representar tudo.

### Presença
`AUSENTE / RECEBIDO`

### Revisão
`NÃO_REVISADO / EM_REVISÃO / ACEITO / RECUSADO`

### Validade
`PERMANENTE / VÁLIDO / VENCENDO / VENCIDO`

### Versão
`ATUAL / SUBSTITUÍDA`

## 28. Exclusão, remoção e arquivamento

Distinguir:

- upload incorreto;
- exclusão de registro;
- arquivamento;
- substituição de versão.

Arquivar significa retirar da operação corrente preservando o histórico.

## 29. Exportação / dossiê

Capacidade Premium futura:

```text
Exportar dossiê documental
```

Pode incluir documentos atuais, versões, validade, responsáveis, situação e histórico.

## 30. Hipótese inicial de planos

### Plano pago inicial

- storage básico;
- upload/download;
- documentos ligados a Subject;
- validade;
- histórico básico;
- versionamento;
- guest upload limitado;
- integração com Expiration.

### Premium

- mais storage;
- OCR;
- extração por IA;
- busca por conteúdo;
- solicitações recorrentes;
- templates de requisitos;
- guest collection avançada;
- auditoria avançada;
- dossiês/exportação.

## 31. Fora do escopo inicial

Não transformar o produto em:

- Google Drive clone;
- editor colaborativo;
- drive desktop;
- árvore arbitrária de pastas;
- sincronização de arquivos;
- workflow BPM genérico;
- assinatura eletrônica;
- GED enterprise completo;
- DLP avançado.

## 32. Modelo funcional norteador

```text
REQUISITO
        ↓
AUSENTE
        ↓
SOLICITAÇÃO
        ↓
CLIENTE ENVIA
        ↓
RECEBIMENTO
        ↓
EXTRAÇÃO / IA
        ↓
REVISÃO HUMANA
        ↓
DOCUMENTO ACEITO
        ↓
VALIDADE
        ↓
RESPONSÁVEL
        ↓
MONITORAMENTO
        ↓
ALERTA
        ↓
RENOVAÇÃO
        ↓
NOVO DOCUMENTO
        ↓
NOVA VERSÃO
        ↓
NOVA VALIDADE
        ↓
HISTÓRICO
        ↺
```

## 33. Evidências de mercado consideradas

A pesquisa de mercado anterior indicou padrões semelhantes em produtos próximos:

- **Nibo Docs:** pedidos de documentos, recebimento via cliente, recorrência e arquivo permanente;
- **Doc Warden:** coleta por link, pendências, aprovação/recusa e controle de vencimentos;
- **Mensum:** renovação ligada ao histórico do documento/contrato;
- **Wedoks/Nexdoxa/GedSys:** storage escalonado por plano e recursos de busca/auditoria.

Conclusão de mercado: storage bruto não é diferencial suficiente; o valor está em **storage + contexto + workflow + validade + histórico + automação**.

## 34. Conclusão

A recomendação é aprovar conceitualmente:

> **Expiration Tracker = gestão de vencimentos + arquivo documental operacional + ciclo de renovação**

com a regra:

> **Um documento armazenado deve possuir contexto de negócio.**
