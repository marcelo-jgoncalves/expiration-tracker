# Expiration Tracker — Jornadas Detalhadas e Critérios de Aceitação do Domínio Documental

**Data:** 31 de agosto de 2026  
**Status:** ESPECIFICAÇÃO FUNCIONAL v0.2  
**Escopo:** jornadas de produto e critérios de aceitação funcionais.  
**Fora de escopo:** arquitetura técnica, AWS, banco de dados, APIs e infraestrutura.

---

# 1. Objetivo

Transformar o modelo documental aprovado em jornadas concretas de usuário.

Este documento descreve:

- intenção do usuário;
- pré-condições;
- fluxo principal;
- alternativas;
- estados;
- resultado esperado;
- critérios de aceitação.

O foco é responder:

> **Como o produto deve funcionar para o usuário?**

---

# 2. Atores funcionais

## Usuário interno

Pessoa membro da Organization.

Pode assumir papéis como:

- Owner;
- Admin;
- Member;
- Viewer.

## Responsável

Usuário interno encarregado de acompanhar um documento, Requirement ou Renewal.

## Guest

Pessoa externa que recebeu um pedido de documento.

Exemplo:

- cliente do escritório contábil;
- fornecedor;
- parceiro;
- colaborador externo.

## Sistema

Responsável por:

- organizar estados;
- calcular validade;
- gerar alertas;
- apresentar sugestões;
- preservar histórico.

## Assistência por IA

Capacidade que:

- lê;
- classifica;
- sugere;
- extrai.

Não é autoridade final no primeiro modelo.

---

# 3. Jornada J1 — Criar um documento manualmente

## Objetivo

Registrar um novo documento associado a um Subject.

## Pré-condições

- usuário autenticado;
- Organization selecionada;
- usuário com permissão adequada;
- Subject existente.

## Fluxo principal

```text
Usuário abre Documents
        ↓
Novo documento
        ↓
Seleciona Subject
        ↓
Seleciona Document Type
        ↓
Faz upload
        ↓
Sistema apresenta metadados
        ↓
IA sugere dados, quando disponível
        ↓
Usuário confirma/corrige
        ↓
Define responsável
        ↓
Confirma
        ↓
Document criado
        ↓
Version atual aceita
```

## Se possuir validade

```text
data confirmada
    ↓
Validity = VALID / EXPIRING / EXPIRED
```

## Se permanente

```text
Validity = NOT_APPLICABLE
```

## Critérios de aceitação

- [ ] O usuário consegue selecionar um Subject.
- [ ] O usuário consegue escolher um tipo documental.
- [ ] O usuário consegue anexar ao menos um arquivo.
- [ ] O produto distingue claramente campos sugeridos e confirmados.
- [ ] O usuário pode corrigir uma sugestão.
- [ ] O usuário pode informar que não há validade.
- [ ] O documento é exibido na lista após criação.
- [ ] A versão criada aparece como atual.
- [ ] O arquivo pode ser visualizado ou baixado.
- [ ] O histórico registra a criação.
- [ ] Se houver validade confirmada, o documento entra no tracking correspondente.

---

# 4. Jornada J2 — Upload com extração assistida

## Objetivo

Reduzir digitação manual.

## Fluxo

```text
Upload
    ↓
Processando
    ↓
Sugestões encontradas
    ↓
Usuário revisa
```

Possíveis sugestões:

- tipo;
- Subject;
- número;
- órgão;
- emissão;
- validade.

## Critérios de aceitação

- [ ] O sistema nunca apresenta dado sugerido como confirmado sem distinção visual.
- [ ] O usuário pode aceitar uma sugestão individualmente.
- [ ] O usuário pode corrigir qualquer sugestão.
- [ ] O usuário pode rejeitar uma sugestão.
- [ ] A falha da IA não impede o cadastro manual.
- [ ] Um campo não identificado permanece explicitamente não identificado.
- [ ] A ausência de confiança suficiente não gera valor inventado.
- [ ] O usuário consegue concluir o fluxo mesmo sem nenhuma sugestão.

---

# 5. Jornada J3 — Criar documento permanente

## Objetivo

Guardar documento relevante sem vencimento.

## Exemplo

Contrato Social.

## Fluxo

```text
Novo Document
    ↓
Tipo
    ↓
Não possui validade
    ↓
Upload
    ↓
Aceite
```

## Critérios de aceitação

- [ ] O usuário pode marcar “sem validade” / “permanente”.
- [ ] O sistema não exige data de vencimento.
- [ ] O documento não aparece como vencido ou pendente de validade.
- [ ] O documento continua pesquisável.
- [ ] O documento aparece no Subject.
- [ ] Pode possuir versões futuras.
- [ ] Pode ser arquivado posteriormente.

---

# 6. Jornada J4 — Adicionar nova versão

## Objetivo

Substituir a versão atual preservando histórico.

## Fluxo

```text
Document Detail
    ↓
Adicionar nova versão
    ↓
Upload
    ↓
Revisão de dados
    ↓
Aceitar
    ↓
versão antiga = SUPERSEDED
nova versão = ACCEPTED
```

## Critérios de aceitação

- [ ] A versão anterior não é apagada.
- [ ] O usuário consegue visualizar versões anteriores.
- [ ] A nova versão passa a ser claramente identificada como atual.
- [ ] A versão anterior passa a ser identificada como substituída.
- [ ] O histórico registra a substituição.
- [ ] Se houver nova validade, o ciclo anterior é encerrado corretamente.
- [ ] A nova validade passa a orientar os novos alertas.

---

# 7. Jornada J5 — Adicionar arquivo complementar

## Objetivo

Adicionar arquivo relacionado sem criar uma nova versão lógica.

## Exemplo

```text
Contrato
├── contrato principal
├── anexo
└── aditivo
```

## Critérios de aceitação

- [ ] A interface pergunta se o upload representa nova versão ou complemento.
- [ ] Arquivo complementar não substitui o arquivo principal automaticamente.
- [ ] Todos os arquivos da versão ficam acessíveis.
- [ ] O histórico identifica quem adicionou cada arquivo.
- [ ] O usuário consegue distinguir arquivo principal de complemento.

---

# 8. Jornada J6 — Solicitar documento a um cliente

## Objetivo

Obter externamente um documento necessário.

## Fluxo

```text
Subject
    ↓
Solicitar documento
    ↓
Seleciona tipo esperado
    ↓
Destinatário
    ↓
Prazo opcional
    ↓
Mensagem
    ↓
Enviar
```

Resultado:

```text
Document Request = SENT
```

## Critérios de aceitação

- [ ] O usuário consegue selecionar o documento esperado.
- [ ] O pedido fica associado ao Subject.
- [ ] O destinatário é claramente exibido antes do envio.
- [ ] Prazo é opcional.
- [ ] O usuário consegue personalizar uma mensagem dentro dos limites do produto.
- [ ] Após envio, o Request aparece na área de solicitações.
- [ ] O estado inicial é claramente visível.
- [ ] O histórico registra envio.
- [ ] O pedido pode ser cancelado enquanto aplicável.

---

# 9. Jornada J7 — Guest envia documento

## Objetivo

Permitir que uma pessoa externa responda ao pedido sem criar conta completa.

## Fluxo

```text
Guest abre link
    ↓
Visualiza o que foi solicitado
    ↓
Seleciona arquivo
    ↓
Envia
    ↓
Recebe confirmação
```

Internamente:

```text
Request = SUBMITTED
Version = RECEIVED
```

## Critérios de aceitação

- [ ] O Guest entende qual documento foi solicitado.
- [ ] Não precisa navegar por funcionalidades internas da Organization.
- [ ] Não precisa criar uma conta completa.
- [ ] Consegue anexar o arquivo permitido.
- [ ] Recebe confirmação clara de envio.
- [ ] O envio não é automaticamente considerado aceito.
- [ ] O usuário interno recebe indicação de novo documento aguardando revisão.
- [ ] O arquivo fica ligado ao Request correto.
- [ ] O Guest não consegue visualizar documentos da Organization fora do contexto permitido.

---

# 10. Jornada J8 — Revisar documento recebido

## Objetivo

Validar um arquivo recebido externamente.

## Fluxo

```text
Review Queue
    ↓
Abrir item
    ↓
Preview
    ↓
Dados extraídos
    ↓
Aceitar
ou
Recusar
```

## Critérios de aceitação

- [ ] A fila mostra documentos aguardando revisão.
- [ ] O revisor consegue visualizar o arquivo.
- [ ] O Subject e o pedido original estão visíveis.
- [ ] Sugestões da IA são identificadas como sugestões.
- [ ] O usuário consegue confirmar/corrigir metadados.
- [ ] Aceitar muda a versão para ACCEPTED.
- [ ] Recusar muda a versão para REJECTED.
- [ ] O Requirement correspondente só é satisfeito após aceite adequado.
- [ ] Toda decisão aparece no histórico.

---

# 11. Jornada J9 — Recusar e solicitar novamente

## Objetivo

Corrigir documento inadequado sem perder contexto.

## Fluxo

```text
Recusar
    ↓
Motivo
    ↓
Comentário
    ↓
Confirmar
    ↓
[Solicitar novamente]
```

## Motivos sugeridos

- vencido;
- ilegível;
- incorreto;
- incompleto;
- Subject incorreto;
- versão antiga;
- outro.

## Critérios de aceitação

- [ ] A recusa exige motivo suficiente para orientar a correção.
- [ ] O arquivo rejeitado continua no histórico.
- [ ] O Requirement não é marcado como satisfeito.
- [ ] O Request anterior não é apagado.
- [ ] O usuário consegue iniciar nova solicitação a partir da recusa.
- [ ] A nova solicitação preserva contexto relevante.
- [ ] O destinatário entende por que precisa reenviar.

---

# 12. Jornada J10 — Renovar documento próximo do vencimento

## Objetivo

Concluir o ciclo operacional de renovação.

## Fluxo

```text
Documento EXPIRING
    ↓
Iniciar renovação
    ↓
Responsável
    ↓
Obter nova versão
    ↓
Upload ou Request
    ↓
Revisão
    ↓
Aceite
    ↓
Versão anterior SUPERSEDED
    ↓
Nova validade
```

## Critérios de aceitação

- [ ] O usuário consegue iniciar renovação a partir do documento.
- [ ] O contexto do documento é preservado.
- [ ] O responsável pela renovação pode ser identificado.
- [ ] O fluxo pode resultar em upload interno ou solicitação externa.
- [ ] A versão antiga continua disponível.
- [ ] A nova versão só substitui a atual após aceite.
- [ ] A nova validade passa a ser a validade operacional.
- [ ] O histórico conecta claramente a renovação anterior à nova versão.

---

# 13. Jornada J11 — Requirement ausente

## Objetivo

Identificar aquilo que deveria existir, mas ainda não existe.

## Exemplo

```text
Fornecedor ACME
Requirement:
CND Municipal
Status:
MISSING
```

## Fluxo

```text
Requirement
    ↓
MISSING
    ↓
Solicitar documento
ou
Upload interno
```

## Critérios de aceitação

- [ ] Um Requirement pode existir sem Document.
- [ ] A ausência é claramente visível.
- [ ] O usuário consegue agir diretamente a partir do Requirement.
- [ ] A ação pode ser solicitar ou cadastrar.
- [ ] O Requirement não aparece como satisfeito até existir evidência válida.

---

# 14. Jornada J12 — Requirement satisfeito

## Fluxo

```text
Requirement
    ↓
Document aceito
    ↓
Validity válida/permanente
    ↓
SATISFIED
```

## Critérios de aceitação

- [ ] O Requirement mostra qual documento o satisfaz.
- [ ] A versão atual é identificável.
- [ ] A validade é exibida quando aplicável.
- [ ] Se a versão expirar, o Requirement deixa de ser plenamente SATISFIED.
- [ ] Se o documento for permanente, expiração não é exigida.

---

# 15. Jornada J13 — Requirement entrando em risco

## Fluxo

```text
SATISFIED
    ↓
Documento entra em janela de vencimento
    ↓
Requirement = EXPIRING
```

## Critérios de aceitação

- [ ] O status muda automaticamente quando a validade entra na janela de atenção.
- [ ] O usuário consegue iniciar renovação a partir do Requirement.
- [ ] A UI informa claramente qual documento está causando o risco.
- [ ] O responsável é visível.

---

# 16. Jornada J14 — Aplicar template de Requirements

## Objetivo

Evitar cadastro repetitivo.

## Exemplo

```text
Template:
Regularidade Anual

CND Federal
CND Estadual
CND Municipal
Alvará
```

## Fluxo

```text
Subject
    ↓
Aplicar template
    ↓
Preview
    ↓
Confirmar
    ↓
Requirements criados
```

## Critérios de aceitação

- [ ] O usuário consegue visualizar o conteúdo do template antes de aplicar.
- [ ] O sistema evita duplicidade óbvia de Requirement equivalente.
- [ ] O usuário entende quais itens serão criados.
- [ ] Os novos Requirements aparecem imediatamente no Subject.
- [ ] Cada Requirement pode depois ser tratado individualmente.

---

# 17. Jornada J15 — Visualizar situação documental de um Subject

## Objetivo

Responder rapidamente:

> A documentação deste Subject está em ordem?

## Tela

```text
Padaria Central Ltda.

12 documentos
8 válidos
2 vencendo
1 vencido
1 permanente

Requirements
7 satisfeitos
1 ausente
1 vencendo
```

## Critérios de aceitação

- [ ] O usuário consegue identificar documentos críticos sem abrir cada item.
- [ ] Válido, vencendo, vencido, permanente e ausente não dependem apenas de cor.
- [ ] Há acesso direto ao item problemático.
- [ ] Documentos e Requirements são distinguíveis.
- [ ] O resumo é consistente com os dados detalhados.

---

# 18. Jornada J16 — Pesquisar documentos

## Objetivo

Encontrar rapidamente um documento pelo contexto.

## Exemplos

```text
Alvará Padaria Central
CND ACME
Procuração João
```

## Critérios de aceitação

- [ ] Busca encontra por título.
- [ ] Busca encontra por Subject.
- [ ] Busca encontra por tipo documental.
- [ ] Filtros podem ser combinados.
- [ ] O usuário consegue filtrar por validade.
- [ ] O usuário consegue filtrar por responsável.
- [ ] O resultado deixa clara a Organization ativa.

---

# 19. Jornada J17 — Review Queue

## Objetivo

Permitir trabalho operacional eficiente.

## Lista

```text
5 aguardando revisão
```

Campos:

- Subject;
- documento esperado;
- quem enviou;
- data;
- prazo;
- origem.

## Critérios de aceitação

- [ ] Itens pendentes são facilmente identificáveis.
- [ ] O usuário consegue abrir o próximo item rapidamente.
- [ ] Aceitar ou recusar atualiza a fila.
- [ ] A fila não mistura Organizations.
- [ ] O usuário consegue filtrar por responsável ou data quando necessário.

---

# 20. Jornada J18 — Arquivar Document

## Objetivo

Retirar documento da operação corrente sem apagar histórico.

## Fluxo

```text
Document Detail
    ↓
Arquivar
    ↓
Confirmação
    ↓
ARCHIVED
```

## Critérios de aceitação

- [ ] O usuário entende que arquivar não é excluir.
- [ ] O histórico é preservado.
- [ ] Versões continuam acessíveis conforme permissão.
- [ ] Documento arquivado deixa de poluir listas operacionais por padrão.
- [ ] O usuário consegue localizar arquivados por filtro.
- [ ] Restauração é possível quando apropriado.

---

# 21. Jornada J19 — Corrigir upload realizado por engano

## Objetivo

Permitir corrigir erro sem confundir com arquivamento.

## Critérios de aceitação

- [ ] “Remover upload” é distinguível de “Arquivar Document”.
- [ ] O usuário recebe confirmação proporcional ao impacto.
- [ ] O sistema explica quando uma versão não pode ser simplesmente removida.
- [ ] Histórico relevante não desaparece silenciosamente.

---

# 22. Jornada J20 — Dashboard documental

## Objetivo

Apresentar trabalho que exige atenção.

Indicadores:

```text
Vencidos
Vencendo
Ausentes
Aguardando cliente
Aguardando revisão
Renovações abertas
```

## Critérios de aceitação

- [ ] Cada indicador permite navegar para a lista correspondente.
- [ ] Quantidades são consistentes com listas filtradas.
- [ ] O dashboard prioriza estado operacional.
- [ ] Consumo de storage não ocupa destaque equivalente a risco operacional.
- [ ] Nenhum estado crítico depende apenas de cor.

---

# 23. Jornada J21 — Solicitação recorrente

## Objetivo

Automatizar pedidos periódicos.

## Fluxo

```text
Criar recorrência
    ↓
Documento esperado
    ↓
Subject
    ↓
Frequência
    ↓
Destinatário
    ↓
Responsável
```

## Critérios de aceitação

- [ ] Cada ocorrência gera uma nova solicitação.
- [ ] Solicitações anteriores permanecem no histórico.
- [ ] A recorrência pode ser pausada.
- [ ] A recorrência pode ser encerrada.
- [ ] O usuário consegue saber qual solicitação pertence a qual ciclo.
- [ ] Falha em um ciclo não apaga os demais.

---

# 24. Jornada J22 — Exportar dossiê documental

## Objetivo

Gerar visão consolidada de um Subject.

## Conteúdo potencial

- documentos atuais;
- validade;
- responsáveis;
- histórico;
- versões selecionadas;
- Requirements.

## Critérios de aceitação

- [ ] O usuário escolhe o Subject.
- [ ] O produto mostra o escopo antes de exportar.
- [ ] O dossiê diferencia atual de histórico.
- [ ] Documentos vencidos não são apresentados como válidos.
- [ ] A exportação respeita permissões.
- [ ] O resultado possui contexto suficiente para ser entendido fora da aplicação.

---

# 25. Critérios transversais — Integridade de informação

Aplicáveis a todas as jornadas.

- [ ] “Recebido” nunca é apresentado como sinônimo de “Aceito”.
- [ ] “Aceito” nunca é apresentado como sinônimo automático de “Válido”.
- [ ] “Sugerido pela IA” é distinguível de “Confirmado”.
- [ ] “Versão atual” é sempre identificável.
- [ ] “Substituído” preserva histórico.
- [ ] “Permanente” não recebe vencimento artificial.
- [ ] Requirement ausente não é mascarado pela existência de arquivo irrelevante.

---

# 26. Critérios transversais — Contexto B2B

- [ ] Toda tela deixa claro o contexto da Organization ativa quando necessário.
- [ ] Trocar Organization não mistura resultados.
- [ ] Busca não retorna documentos de outra Organization.
- [ ] Requests pertencem à Organization correta.
- [ ] Review Queue pertence à Organization ativa.
- [ ] Um Guest vê somente o mínimo necessário para responder ao pedido.

---

# 27. Critérios transversais — Segurança percebida pelo usuário

Sem entrar em implementação:

- [ ] Ações destrutivas têm linguagem clara.
- [ ] O usuário sabe quando está compartilhando algo externamente.
- [ ] O destinatário de uma solicitação é revisável antes do envio.
- [ ] O produto não expõe informação interna desnecessária ao Guest.
- [ ] Download e preview respeitam permissões funcionais.

---

# 28. Critérios transversais — Recuperação de erro

- [ ] Falha de upload não apaga metadados já preenchidos.
- [ ] Falha de IA não impede continuidade manual.
- [ ] Falha ao enviar Request permite tentar novamente.
- [ ] Recarregar a tela não cria documento duplicado sem intenção.
- [ ] Ações críticas deixam claro se foram ou não concluídas.
- [ ] O usuário não precisa repetir trabalho desnecessariamente.

---

# 29. Critérios transversais — Acessibilidade funcional

- [ ] Status não depende apenas de cor.
- [ ] Ações principais podem ser realizadas por teclado.
- [ ] Campos possuem rótulos compreensíveis.
- [ ] Erros são associados aos respectivos campos.
- [ ] Preview não deve impedir acesso alternativo ao arquivo.
- [ ] Modais e drawers possuem comportamento previsível de foco.
- [ ] Informação crítica continua compreensível em zoom/reflow.

---

# 30. Critérios transversais — Responsividade

Em telas pequenas:

- [ ] tarefas críticas continuam possíveis;
- [ ] upload continua utilizável;
- [ ] revisão continua compreensível;
- [ ] tabelas possuem alternativa adequada;
- [ ] ações primárias não desaparecem;
- [ ] informações críticas permanecem acessíveis.

---

# 31. Critérios transversais — Histórico

Eventos relevantes devem produzir histórico funcional:

- criação;
- upload;
- substituição;
- aceite;
- recusa;
- mudança de responsável;
- confirmação de validade;
- renovação;
- arquivamento;
- restauração.

O histórico deve responder:

```text
o que aconteceu
quem fez
quando
```

quando essas informações forem aplicáveis.

---

# 32. Critérios de aceitação do primeiro núcleo documental

Uma primeira entrega funcional coerente precisa permitir, no mínimo:

```text
Subject
    ↓
Document
    ↓
Document Version
    ↓
File
    ↓
Validity
    ↓
Expiration
    ↓
Renewal
```

Com:

- upload;
- preview/download;
- histórico;
- versão atual;
- versões anteriores;
- documento permanente;
- responsável.

Não é obrigatório que OCR/IA esteja disponível para considerar o núcleo funcional completo.

---

# 33. Segundo núcleo funcional

Após o núcleo documental:

```text
Document Request
    ↓
Guest Upload
    ↓
Review
    ↓
Accept / Reject
```

Critério de sucesso:

> o escritório consegue solicitar, receber, revisar e aceitar um documento sem depender de WhatsApp/e-mail como sistema de registro.

---

# 34. Terceiro núcleo funcional

```text
Requirement
    ↓
MISSING / SATISFIED / EXPIRING
    ↓
Request / Upload
```

Critério de sucesso:

> o usuário consegue identificar não apenas o que possui, mas o que está faltando.

---

# 35. Quarto núcleo funcional

Capacidades avançadas:

```text
OCR
IA
Search Content
Recurring Requests
Templates
Dossier
Advanced Audit
```

Essas capacidades ampliam produtividade e justificam diferenciação Premium.

---

# 36. Jornada crítica ponta a ponta

A jornada mais representativa do produto documental é:

```text
Requirement criado
        ↓
Documento ausente
        ↓
Solicitação enviada
        ↓
Cliente faz guest upload
        ↓
Documento recebido
        ↓
IA sugere metadados
        ↓
Usuário revisa
        ↓
Documento aceito
        ↓
Requirement satisfeito
        ↓
Validade monitorada
        ↓
Alerta
        ↓
Renovação iniciada
        ↓
Nova versão recebida
        ↓
Aceite
        ↓
Histórico preservado
```

Essa jornada deve futuramente ser um dos principais testes E2E do produto.

---

# 37. Critério de produto para aprovação desta fase

O domínio documental estará funcionalmente bem especificado quando conseguirmos responder sem ambiguidade:

1. O que é um Document?
2. O que é uma Version?
3. Quando uma versão substitui outra?
4. Quando um arquivo é apenas recebido?
5. Quando passa a ser aceito?
6. Como validade é confirmada?
7. Como um Requirement é satisfeito?
8. Como solicitamos documento externamente?
9. Como ocorre uma renovação?
10. Como o histórico é preservado?
11. Como documentos permanentes funcionam?
12. Como a IA participa sem criar falsa certeza?

Este documento responde essas perguntas no nível de produto.

---

# 38. Próximo passo recomendado

Com decisões e jornadas funcionais fechadas, a próxima etapa natural é:

> **desenhar a arquitetura de informação e as superfícies/telas do módulo documental dentro do Design System atual.**

Isso inclui:

- navegação;
- Documents Collection;
- Document Detail;
- Subject Documents;
- Requirements;
- Requests;
- Review Queue;
- Renewal flow;
- Guest Upload flow;
- estados vazios;
- loading/error/unknown;
- mobile/reflow.

Somente depois disso é recomendável iniciar o desenho técnico/arquitetural.
