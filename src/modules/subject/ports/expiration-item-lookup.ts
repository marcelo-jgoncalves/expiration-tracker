/**
 * Porta mínima e somente-leitura para o módulo subject validar que um `itemId` referenciado
 * (ex. em `linkExpirationItem`) existe de fato e pertence ao tenant, sem o módulo subject
 * depender diretamente do store/serviço internos de expiration (mantém o boundary entre
 * módulos — cada um só expõe o que o outro genuinamente precisa consumir).
 */
export interface ExpirationItemLookup {
  /** true apenas se o item existir e não estiver soft-deleted (mesmo critério de
   * ExpirationService.readActiveItem). */
  itemExists(tenantId: string, itemId: string): Promise<boolean>;
}
