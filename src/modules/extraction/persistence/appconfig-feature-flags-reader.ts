/**
 * Real `FeatureFlagsReader` adapter, direct `@aws-sdk/client-appconfigdata` calls (no Lambda
 * extension/layer). Decision recorded in `NEXT_SESSION_PROMPT.md`: the AWS-recommended Lambda
 * extension (`http://localhost:2772/...`) needs a managed Lambda Layer ARN wired through
 * `infra/modules/lambda-function`, which has no precedent anywhere in this repo yet (only
 * `adot_layer_arn` exists, a different layer). Adding that plumbing for a single, low-QPS
 * consumer (this handler only reads flags once per `START_OCR` invocation, not per document
 * page/block) is a bigger infra change than the problem needs. `client-appconfigdata` gives the
 * same "poll for a changed value, otherwise get an empty body back" session protocol the
 * extension itself is built on — this adapter just does that polling directly, with the SAME
 * one-call-per-invocation cost the extension would have on a cold Lambda anyway. Revisit if
 * volume ever makes the per-invocation API call cost/latency material (extension amortizes
 * across warm invocations via its local cache, this adapter only amortizes within one
 * long-running process/session token).
 *
 * `getFlags()` never resolves to "unknown, proceed" — any read/parse error throws, per the
 * port's own fail-closed contract (the CALLER treats a throw as OCR=false).
 */
import { AppConfigDataClient, StartConfigurationSessionCommand, GetLatestConfigurationCommand } from "@aws-sdk/client-appconfigdata";
import type { FeatureFlags, FeatureFlagsReader } from "../ports/feature-flags-reader.js";

export interface AppConfigFeatureFlagsReaderConfig {
  applicationId: string;
  environmentId: string;
  configurationProfileId: string;
}

export class AppConfigFeatureFlagsReader implements FeatureFlagsReader {
  private nextToken: string | undefined;
  private cachedFlags: FeatureFlags | undefined;

  constructor(
    private readonly client: AppConfigDataClient,
    private readonly config: AppConfigFeatureFlagsReaderConfig,
  ) {}

  async getFlags(): Promise<FeatureFlags> {
    if (!this.nextToken) {
      const session = await this.client.send(
        new StartConfigurationSessionCommand({
          ApplicationIdentifier: this.config.applicationId,
          EnvironmentIdentifier: this.config.environmentId,
          ConfigurationProfileIdentifier: this.config.configurationProfileId,
        }),
      );
      if (!session.InitialConfigurationToken) {
        throw new Error("AppConfigData StartConfigurationSession returned no InitialConfigurationToken.");
      }
      this.nextToken = session.InitialConfigurationToken;
    }

    const result = await this.client.send(new GetLatestConfigurationCommand({ ConfigurationToken: this.nextToken }));
    this.nextToken = result.NextPollConfigurationToken ?? this.nextToken;

    if (result.Configuration && result.Configuration.length > 0) {
      const text = Buffer.from(result.Configuration).toString("utf-8");
      const parsed = JSON.parse(text) as Partial<FeatureFlags>;
      this.cachedFlags = {
        AI_EXTRACTION: parsed.AI_EXTRACTION === true,
        OCR: parsed.OCR === true,
        WHATSAPP: parsed.WHATSAPP === true,
      };
    }

    if (!this.cachedFlags) {
      throw new Error("AppConfigData GetLatestConfiguration returned no configuration body on first poll.");
    }
    return this.cachedFlags;
  }
}

export function createAppConfigDataClient(): AppConfigDataClient {
  return new AppConfigDataClient({});
}
