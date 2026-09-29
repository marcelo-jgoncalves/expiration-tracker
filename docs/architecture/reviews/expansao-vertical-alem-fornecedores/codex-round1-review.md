(Saved verbatim from `codex exec` output, Rodada 1 — nota 6,8/10, sem convergência.)

**Nota independente do Codex: 6,8/10.** Concorda com "investigar demanda antes de alterar o produto", mas não aprova a análise como está.

**Verificação factual** (tabela): 7 tipos de `TrackedSubject` confirmados; traduções confirmadas; cota independente de `VENDOR` confirmada pelo COMPORTAMENTO (`subject-service.ts:98/134`), não só pela declaração; `Requirement.category`/`ExpirationItem.category` **parcialmente falso** — `Requirement` não tem `category`, só `name` livre (`requirement.ts:48`); tipos documentais configuráveis confirmado para cadastro/nomenclatura, não para adequação de tratamento; pricing ainda é proposta (confirmado, `planos-precos-2026-09-27.md:5`) usando "fornecedores" (linha 31/35).

Contagem `rg -i fornecedor`: `src/modules/` 2 ocorrências (ambas comentário); `frontend/src/` 148 ocorrências/32 arquivos (comentários + copy executável, nenhuma regra de negócio condicionada); `frontend/e2e/` 59 ocorrências/5 specs (mistura fixture/seletor/comentário — nem todas exigem mudança). `SubjectForm.tsx:35/53` tem default `VENDOR` apesar de oferecer todos os tipos — sinal de especialização que a proposta omitiu.

**Achados, por severidade:**

1. **Alta** — "a limitação é só copy/pricing" excede a evidência. O código reutiliza cadastro/requisitos/documentos/cotas, mas não prova cobertura de relações empregado-empregador, veículo-condutor, imóvel-proprietário-locatário (`requirement.ts:44/61` — 1 requisito pertence a 1 subjectId, 1 evidência corrente). Conclusão defensável: baixo custo PROVÁVEL de reutilizar o controle documental básico; custo de atender cada vertical ainda INDETERMINADO.

2. **Alta** — inventário comercial incompleto, "nicho validado" não demonstrado. `first-customers-acquisition-strategy.md:45` já propõe escritórios contábeis; linha 1035 já lista "próximos segmentos"; linha 1051 já declara "produto horizontal, marketing vertical". `pesquisa-concorrencia-2026-09-27.md:13/39` já distingue segmentos e cita foco trabalhista/ASO. **"Não existe pesquisa além de fornecedores" é falso.**

3. **Alta** — landing page (opção D) mede interesse na mensagem, não resolve demanda sozinha (falta público/canal/oferta/preço testado/critério de avanço).

4. **Média** — caracterização do portal/e-mail como "fala com fornecedor" está incorreta. E-mail real (`email-templates.ts:97`) é genérico ("Solicitação de envio de documento"); portal usa `{subjectDisplayName}` (`GuestDocumentRequest.tsx:92`); o `{Fornecedor}` citado só existe em COMENTÁRIO de backend.

5. **Média** — faltam riscos materiais: dados de saúde sensíveis (ANPD) para RH/ASO; economia (mesma contagem de subjects, custo de OCR/mensagens/atendimento pode variar muito por vertical, o próprio pricing:388 já reconhece a lacuna de dados); marca/suporte (atender vários segmentos aumenta materiais/dúvidas/roadmap conflitante).

6. **Média** — tabela A-E mistura experimento comercial com mudança de UI e omite a alternativa já documentada: diagnóstico→demo→trial→onboarding concierge com caso de uso estreito, usando o produto já existente (`first-customers-acquisition-strategy.md:22`).

**Recomendação do Codex**: investigação comercial delimitada, sem mudança inicial de código — selecionar 1 caso de uso (contabilidade entra na comparação, não descartada), entrevistas sobre situações recentes, demo com dados sintéticos, buscar compromisso concreto de piloto+preço, só então reavaliar ajustes de produto/economia.

**Veredito**: "vale investigar a expansão; ainda não há base para afirmar que vale expandir o posicionamento." Protocolo não convergido; mínimo 3 rodadas seguem obrigatórias.
