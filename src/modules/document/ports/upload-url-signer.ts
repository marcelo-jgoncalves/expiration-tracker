/** Presigned-URL generation port — M6 design §3.1. Real adapter uses
 * @aws-sdk/s3-request-presigner; kept behind a port so DocumentService stays testable without
 * AWS credentials. */
export interface PresignUploadInput {
  bucket: string;
  key: string;
  mediaType: string;
  contentLength: number;
  checksumSha256: string;
  metadata: Record<string, string>;
  expiresInSeconds: number;
}

export interface PresignUploadResult {
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
}

export interface UploadUrlSigner {
  presignUpload(input: PresignUploadInput): Promise<PresignUploadResult>;
}
