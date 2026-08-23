/**
 * S3 surface do módulo import — porta deliberadamente pequena (get/put bytes), diferente de
 * `DocumentObjectStore` (headObject/copyObject/deleteObjectVersion, moldado pelo par
 * quarentena->limpo do pipeline de malware scanning de M6). Import v1 NUNCA passa por
 * scanning de malware (achado/decisão registrada: CSV é conteúdo textual, o vetor que
 * GuardDuty Malware Protection cobre é binário/executável; entra direto num bucket dedicado,
 * nunca no bucket de quarentena de documentos) — então o par de operações que este módulo
 * precisa (ler o CSV enviado, escrever/ler o plano JSONL) é genuinamente mais simples.
 */
export interface ImportObjectStore {
  getObject(bucket: string, key: string): Promise<Buffer>;
  putObject(bucket: string, key: string, body: string, contentType: string): Promise<void>;
}
