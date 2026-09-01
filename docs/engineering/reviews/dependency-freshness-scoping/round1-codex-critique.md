## Rodada 1 — Crítica Codex

**Resultado: `REABRIR`.** A direção é correta, mas a proposta ainda não pode ser aprovada porque a sub-rubrica viola requisitos centrais do E-014 e o mecanismo sugerido não fecha o mesmo tipo de lacuna que originou D-137.

### 1. Contestação da régua

O “checklist de critérios pesados” não é ainda uma sub-rubrica válida:

- Não há pesos numéricos somando 100%.
- Não há âncoras verificáveis de “atende”/“não atende”.
- Não está definido como os quatro critérios produzem a nota final.
- As fontes não têm data de acesso nem justificativa de representatividade.
- Duas fontes de “mercado 2026” são secundárias e não agregam autoridade à política. Para ciclos de vida concretos, as fontes primárias de Node.js, AWS, HashiCorp, GitHub e mantenedores das dependências são superiores.
- O checklist omite uma propriedade essencial: **a fonte de verdade deve ser atualizável ou verificada contra upstream**. Uma tabela local pode provar que a data que alguém digitou já passou; não prova que uma nova data, runtime ou release apareceu.

Sob `research-protocol.md`, isso abre disputa sobre a própria régua. Portanto, registro as notas separadamente:

- **Nota da régua: 5,8/10**
- **Nota do design, avaliado pela intenção do checklist atual: 7,4/10**

Nenhuma das duas atinge o gate 9,0.

### 2. “Uma major atrás” está mal definida

A regra não é desproporcional; ela é semanticamente instável.

Em 31/08/2026, Node 26 é a versão *Current*, enquanto Node 24 e 22 são LTS. O próprio Node recomenda produção somente em Active LTS ou Maintenance LTS. Assim, “uma major atrás da mais recente com suporte ativo” pode produzir interpretações diferentes:

- comparar com Node 26, embora ainda não seja LTS;
- contar majors ímpares já EOL;
- comparar somente linhas LTS;
- exigir Node 24 ou aceitar Node 22.

Além disso, “Node LTS a cada dois anos” não descreve corretamente o ciclo histórico: até Node 26, majors pares tornam-se LTS, com uma nova linha LTS anual. A política mudará novamente a partir do Node 27. [Node.js Releases](https://nodejs.org/en/about/previous-releases)

A regra deveria ser orientada a estado e horizonte, não à aritmética de majors:

> O runtime principal deve estar em uma linha LTS suportada pelo mantenedor e pelo provedor gerenciado, com pelo menos 6 meses restantes até o primeiro EOL aplicável, salvo exceção registrada. Releases Current/preview não contam como alvo estável.

Isso é mais decidível e permanece válido quando a cadência muda.

Para Lambda, devem ser consideradas separadamente:

1. EOL upstream da linguagem;
2. depreciação do runtime AWS;
3. bloqueio de criação;
4. bloqueio de atualização.

AWS informa que Node 24 deprecia em 30/04/2028 e que Node 26 ainda está em preview, sem SLA/suporte e sem adequação a workload de produção. Logo, Node 24 é hoje o alvo correto, independentemente de Node 26 ser a major numericamente mais recente. [AWS Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)

Recomendo:

- **Gate:** nenhum componente EOL/depreciado.
- **Janela de ação:** falhar quando restarem menos de **6 meses**, alinhada ao aviso mínimo de 180 dias da AWS, não três meses.
- **Janela anterior:** entre 6 e 12 meses, emitir aviso e exigir item rastreável.
- **Exceção:** somente com owner, justificativa, compensação e data de expiração em `exceptions.md`.

A ausência de produção reduz a complexidade necessária para rollout, mas não justifica operar em runtime sem patches. Portanto, o rigor do gate é proporcional; o que deve ser simples é sua implementação.

### 3. A tabela proposta contém duplicação perigosa

Esta forma deve ser rejeitada:

```text
{ runtime/dependência, versão pinada atual, data de EOL, fonte }
```

A “versão pinada atual” já existe em `.nvmrc`, `package-lock.json`, `.terraform.lock.hcl`, constraints Terraform e configuração Lambda. Copiá-la para uma tabela cria outra fonte de drift.

O checker deve:

- extrair versões e constraints dos arquivos reais;
- manter localmente apenas a política que não existe no repositório — classe crítica, calendário/horizonte e URL oficial;
- verificar que todo item crítico descoberto possui política;
- verificar que nenhuma entrada da política ficou órfã;
- verificar consistência entre `.nvmrc`, build target e runtime Lambda;
- falhar por EOL/janela, constraint incompatível e item crítico sem cobertura.

Mesmo assim, uma data curada pode ficar obsoleta se o fornecedor antecipar ou alterar seu calendário. Logo, o script determinístico é um **backstop offline**, não o mecanismo completo de descoberta.

### 4. SCA e tabela não são alternativas

A solução proporcional é híbrida:

- **Dependabot/Renovate:** descoberta periódica de novas versões para npm, GitHub Actions e Terraform; abre PR e torna a atualização visível.
- **SCA existente:** `npm audit`/advisories para vulnerabilidades conhecidas.
- **Checker local:** invariantes próprias do projeto, compatibilidade cruzada e datas de EOL de runtime/linguagem.
- **Fontes oficiais:** Node/AWS para lifecycle; advisories e releases do mantenedor para cada tecnologia.

O repositório não possui atualmente `.github/dependabot.yml`. Esse é um gap material. O lockfile Terraform fixa a versão efetivamente selecionada; a constraint define o conjunto permitido, e `terraform init -upgrade` é necessário para reconsiderar versões mais novas. Um check apenas sobre constraints pode declarar frescor enquanto o lock continua antigo. [HashiCorp: dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock)

Não considero necessário adotar uma plataforma SCA pesada. Dependabot ou Renovate, mais os checks existentes, é proporcional. Contudo, **a tabela manual isolada é insuficiente**, porque não detecta a publicação de uma nova LTS/major — justamente um dos gatilhos prometidos pela proposta.

### 5. O escopo de dependências precisa de taxonomia objetiva

“Dependências npm críticas” não pode ser somente uma lista de nomes escolhidos informalmente. A definição deve ser baseada em impacto, por exemplo:

- executa na fronteira de segurança ou entrada não confiável;
- participa de autenticação, autorização, validação ou criptografia;
- está presente em runtime Lambda;
- determina formato persistido ou contrato público;
- controla build/deploy/infra;
- tem blast radius transversal.

React e TanStack Query podem ser importantes ao produto, mas não pertencem necessariamente à mesma urgência do runtime Node, AWS provider ou biblioteca de validação. Transitivas não devem simplesmente receber “peso bem menor”: uma transitiva explorável em runtime pode exigir resposta imediata. A urgência depende de exposição e severidade, não de ser direta ou transitiva.

Também falta separar:

- **frescor**: disponibilidade de versão mais recente;
- **suporte**: versão ainda mantida;
- **vulnerabilidade**: advisory aplicável;
- **compatibilidade**: versão necessária para outro componente;
- **proveniência/integridade**: já coberta pelo Domínio G.

### 6. Revisão por eventos oportunistas não garante periodicidade

“Quando uma auditoria já estiver tocando o código” mantém o problema ad-hoc que permitiu D-137. E “quando uma nova LTS for publicada” não é gatilho operacional se nenhum mecanismo detectar a publicação.

Deve existir ao menos uma execução agendada automatizada, por exemplo semanal, além de PR/push:

```text
upstream release/advisory
        ↓
Dependabot/Renovate ou consulta oficial agendada
        ↓
PR/issue/CI visível
        ↓
checker valida invariantes e horizonte
```

Isso não obriga atualização semanal; apenas garante descoberta independente de alguém tropeçar no problema.

## Sub-rubrica reconciliada proposta para a Rodada 2

Sugiro substituir o checklist original por:

1. **Cobertura e fonte de verdade — 25%**  
   Atende: inventário crítico definido por regra objetiva; versões lidas dos manifests/lockfiles; fontes oficiais com data de acesso.  
   Não atende: versão duplicada manualmente ou classes críticas sem cobertura.

2. **Lifecycle e horizonte operacional — 25%**  
   Atende: gate de suporte vigente, janelas de 6/12 meses, distinção entre upstream e provedor gerenciado, exceção formal.  
   Não atende: apenas “N majors atrás” ou reação somente após EOL.

3. **Descoberta independente — 25%**  
   Atende: automação agendada detecta novas versões/advisories e produz artefato acionável.  
   Não atende: depende de atualização humana da própria tabela ou de auditoria oportunista.

4. **Resposta proporcional por risco — 15%**  
   Atende: urgência determinada por EOL, explorabilidade, severidade e exposição; rotina recebe backlog normal.  
   Não atende: toda atualização tem a mesma prioridade ou transitivas são rebaixadas automaticamente.

5. **Verificabilidade e drift control — 10%**  
   Atende: CI prova consistência entre runtime, build, manifests, lockfiles e política; falha de forma reproduzível.  
   Não atende: documento sem enforcement ou checker que valida apenas os dados que ele próprio contém.

Além desses pesos, manteria gates binários:

- nenhum runtime/linguagem EOL ou runtime gerenciado depreciado;
- nenhum item crítico sem owner/fonte/mecanismo de descoberta;
- nenhuma exceção vencida;
- nenhuma incompatibilidade conhecida entre runtime e provider/build target.

**Conclusão:** mantenha o novo standard, substitua “uma major atrás” por “LTS suportada + horizonte mínimo”, e adote o modelo híbrido Dependabot/Renovate + checker determinístico. O checker local sozinho não resolve o incidente-raiz; a SCA sozinha também não cobre adequadamente lifecycle de Lambda/Node nem invariantes cruzadas do repositório.
