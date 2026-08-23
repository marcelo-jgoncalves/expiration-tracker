/** Real S3 adapter for ImportObjectStore (M11). Get/put simples - sem versionId/malware
 * scanning envolvidos (ver ports/import-object-store.ts para o porquê). */
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { ImportObjectStore } from "../ports/import-object-store.js";

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class S3ImportObjectStore implements ImportObjectStore {
  constructor(private readonly client: S3Client) {}

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return streamToBuffer(result.Body);
  }

  async putObject(bucket: string, key: string, body: string, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  }
}
