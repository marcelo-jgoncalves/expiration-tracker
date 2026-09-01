## Rodada 2 — Parecer Codex

**Nota: 8,8/10 — NÃO APROVADO nesta rodada. Rodada 3 necessária.**

A escolha de **Dependabot está correta** para este repositório. Não há limitação atual de múltiplos diretórios Terraform ou agrupamento que justifique adotar Renovate: Dependabot suporta `directories`, globbing e agrupamento por dependência entre diretórios do mesmo ecossistema; também suporta grupos entre ecossistemas. [GitHub Docs — múltiplos diretórios](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference), [GitHub Docs — multi-ecosystem updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/multi-ecosystem-updates).

O bloqueio restante não é Dependabot; é a modelagem do checker e a cobertura inicial.

### Pontuação

| Critério | Peso | Nota ponderada |
|---|---:|---:|
| Cobertura e fonte de verdade | 25% | 21,0 |
| Lifecycle e horizonte operacional | 25% | 20,5 |
| Descoberta independente | 25% | 23,5 |
| Resposta proporcional por risco | 15% | 14,0 |
| Verificabilidade e drift control | 10% | 9,0 |
| **Total** | **100%** | **88,0/100** |

### Correções bloqueantes

1. **A política de EOL precisa estar vinculada à linha de versão extraída.**

Uma entrada apenas por nome:

```text
Node.js → EOL 2028-04-30
```

não permite provar que a data corresponde à versão extraída. Se `.nvmrc` mudar de 24 para 26, o checker poderia continuar aplicando silenciosamente o EOL do Node 24.

A política deve conter uma seleção de linha, não necessariamente a versão exata:

```ts
{
  id: "node",
  detectedFrom: [".nvmrc", "package.json#engines.node"],
  supportedLine: "24",
  supportEndsAt: "2028-04-30",
  officialSource: "...",
  verifiedAt: "..."
}
```

Isso não duplica a versão instalada: `24.7.0`, por exemplo, continua vindo do repositório. Registra apenas a linha à qual a evidência de lifecycle se aplica. O checker deve falhar quando a linha detectada não casar com `supportedLine`.

2. **A cobertura inicial contradiz a própria taxonomia.**

A proposta diz que são críticos:

- runtime/linguagem;
- runtime gerenciado e ADOT;
- ferramentas de build/deploy/infra;
- componentes transversais.

Mas a população inicial nomeada contém apenas Node, Lambda runtime e `hashicorp/aws`. Pelo próprio critério, faltam ao menos:

- camada ADOT e o ARN/versionamento configurado por ambiente;
- Terraform CLI, fixado em CI;
- esbuild;
- GitHub Actions efetivamente usadas, ou uma regra explícita dizendo que sua descoberta/lifecycle pertence exclusivamente ao bloco `github-actions` do Dependabot;
- possivelmente AWS SDK v3 e Ajv, com classificação explícita sobre quais recebem apenas freshness discovery e quais também possuem lifecycle curado.

A âncora “nenhum item crítico sem owner/fonte/descoberta” seria violada na implementação inicial proposta.

3. **A descoberta de itens críticos precisa ser decidível.**

“Falhar se um item crítico descoberto não tiver política” exige que o checker saiba mecanicamente quais itens são críticos. Os critérios semânticos são bons para humanos, mas o script não consegue inferir que uma biblioteca “participa de autorização” apenas lendo `package.json`.

O standard deve distinguir:

- inventário automaticamente descoberto;
- regra/matcher que classifica o item como crítico;
- política de lifecycle aplicável;
- owner e fonte oficial.

Um manifesto de matchers/IDs é aceitável. O que não pode existir é uma lista manual de versões instaladas.

4. **O conjunto de fontes reais precisa ser corrigido.**

O repositório não possui `infra/versions.tf` na raiz. Há `versions.tf` e `.terraform.lock.hcl` distribuídos por vários módulos. Portanto, o checker deve descobrir recursivamente:

```text
infra/**/versions.tf
infra/**/.terraform.lock.hcl
```

e validar todas as ocorrências, inclusive divergências entre constraints e locks.

Há ainda um achado real que prova o valor desse gate: `.nvmrc` e `package.json` dizem Node 24, mas o bloco raiz de `package-lock.json` ainda registra `engines.node = 20.x`. A inconsistência deve ser bloqueante.

5. **A separação entre vulnerabilidade e freshness precisa ficar exata.**

Dependabot version updates descobre versões novas; Dependabot security updates e o dependency graph tratam advisories; `npm audit` é o gate local/CI. Não se deve dizer que “Dependabot cobre ambas via `npm audit`”: são mecanismos independentes. Além disso, para ecossistemas diferentes de npm, Dependabot pode não conseguir corrigir uma transitiva se isso exigir atualizar a dependência pai. [GitHub Docs — security updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates).

### Dependabot versus Renovate

**Decisão: manter Dependabot.**

A configuração adequada pode usar:

- `npm` com `directories: ["/", "/frontend"]`;
- `terraform` com `directories` ou glob cobrindo `/infra` e `/infra/modules/*`;
- `github-actions` com `directory: "/"`;
- agrupamento por `dependency-name` quando a mesma dependência aparece em vários módulos;
- grupos separados, evitando um PR gigante que misture majors de npm, provider AWS e Actions;
- nenhum auto-merge.

Uma ressalva operacional deve entrar no standard: o GitHub pode pausar version updates quando mantenedores deixam de interagir com PRs do Dependabot. Portanto, “configuração presente” não basta como evidência perpétua; o owner deve verificar periodicamente o estado da integração. [GitHub Docs — automatic deactivation](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates).

### Condição objetiva para aprovação na Rodada 3

A próxima rodada pode atingir o gate sem trocar de ferramenta se incorporar:

1. associação explícita `linha detectada → data de lifecycle`;
2. inventário crítico inicial coerente com a taxonomia;
3. mecanismo decidível de classificação/cobertura;
4. descoberta recursiva dos arquivos Terraform reais;
5. separação terminológica entre version updates, security updates e `npm audit`;
6. Node do `package-lock.json` incluído na invariante cruzada;
7. owner verificável para triagem dos PRs e para detectar Dependabot pausado.

A arquitetura híbrida **Dependabot + checker determinístico** permanece correta; a Rodada 3 precisa fechar sua especificação executável.
