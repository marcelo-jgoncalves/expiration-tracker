**7.5/10** (registrada antes de rodar o Codex).

Arquitetura correta e consistente com os 3 tipos existentes, tenant isolation limpa, validação de
schema fechada. Não chega a 9 porque a investigação revelou um achado real de correção (não só
"gap de produto conhecido"): a claim de dedupe órfã sendo tratada como "sucesso" numa nova
tentativa é um bug lógico genuíno (perda silenciosa e permanente de uma linha de import), agravado
para Item por não ter nenhum branch de erro conhecido (diferente de TrackedSubject's
QuotaExceededError). Isso não foi pego antes por ser um padrão pré-existente reaproveitado, mas
reaproveitar um padrão com um bug latente para um novo caso de uso com superfície de erro MAIOR
merece nota mais baixa que "apenas documentar a limitação" sugere. Zero teste cobre esse cenário
nem o de colisão com Item manual.
