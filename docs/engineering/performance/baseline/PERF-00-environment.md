# PERF-00 — Baseline congelado e ambiente de referência

## Commit testado

- SHA: `8ade66960ae36f51b8cf1b7553e4245d684f6794`
- Log: `8ade669 feat(reports): close A16's execution-history gap (D-293)`
- Branch de origem: `develop`
- Branch de trabalho do programa: `perf/performance-program-v1`
- Data de congelamento: 2026-09-14

## Convenção de ID de experimento

`PERF-Exxx` (três dígitos, sequencial, nunca reaproveitado mesmo se um experimento for descartado).
Um arquivo por experimento em `experiments/PERF-Exxx-nome-curto.md`, a partir de `experiments/TEMPLATE.md`.

## Ambiente de referência (máquina/navegador para os testes principais de frontend)

- OS: Microsoft Windows 11 Pro 10.0.26200
- CPU: 12th Gen Intel(R) Core(TM) i5-1235U
- RAM total: 15.7 GB
- Node: v24.15.0
- npm: 11.12.1
- Browser: Google Chrome 152.0.7977.84

Observação: máquina de desenvolvimento local, não isolada/dedicada — variação de carga de fundo é
esperada. Testes sensíveis a ruído (Power Tuning, load testing) devem preferir execução via
CloudWatch/Lambda/k6 remoto em vez de depender de medições locais de CPU/rede desta máquina.

## Critério de saída (PERF-00)

Um teste é reproduzível exatamente a partir deste registro: mesmo SHA, mesma branch, mesmo ambiente
documentado aqui, convenção de ID seguida, template de experimento usado.
