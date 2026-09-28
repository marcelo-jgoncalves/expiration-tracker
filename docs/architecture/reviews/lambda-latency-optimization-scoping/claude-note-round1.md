---
status: final (rodada 1)
---

# Nota da Rodada 1 — Claude (autor da proposta)

Codex: 7,12/10. Concordo com todos os achados.

- **2 erros factuais** — procedem: o override de 512MB pertence a `parser-sandbox-handler`, não
  `pdf-parser-task-handler` (não verifiquei o handler certo antes de escrever); o mínimo de memória
  do Lambda é 128MB, não 256MB (nunca verifiquei o mínimo real, só descrevi o default do projeto
  incorretamente como "o patamar mais lento disponível").
- **Falta baseline real** — procede, e é o achado mais importante: eu inferi "cold start domina" só
  de fontes externas genéricas, nunca medi ESTE sistema. Corrigido nesta rodada com dados reais do
  CloudWatch de `dev` (ver seção nova abaixo).
- **B não prova auditabilidade preservada** — procede. `keepNames` preserva nomes de função, nunca
  linha/coluna; `sourcemap:"external"` gera o `.map` mas nada configura `NODE_OPTIONS=--enable-source-maps`
  nem qualquer resolvedor — confirmei que essa env var não existe em nenhum Lambda hoje. Minha
  alegação era otimista, não verificada.
- **A muda o default compartilhado, afetando workers também** — procede, escopo errado. Corrigido
  para override explícito só nos handlers tenant-facing.
- **Custo "zero" não é garantido** — procede, retirado.
- **Keep-alive não é um achado, é ausência de evidência de problema** — procede, retirado como
  "achado", não proponho mudança ali nesta rodada.
- **SnapStart: framing amplo demais** — procede. O anúncio é sobre empacotamento em imagem de
  container; este projeto empacota como ZIP (`nodejs24.x` gerenciado) — a alegação certa é "não se
  aplica a ESTE empacotamento", não "não existe para Node.js" de forma absoluta.
- **Falta critério de sucesso/plano de validação** — procede, adicionado explicitamente.

Nota geral desta rodada (minha, como autor): **6,8/10** — a direção A-D não estava errada, mas
carecia de evidência própria do sistema e tinha 2 erros factuais + 1 alegação não verificada.
Endereçado na Rodada 2 com dados reais de `dev` (CloudWatch, `--profile claude-dev`, per AGENTS.md
§7).
