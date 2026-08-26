/** Unit tests for `SfnTaskTokenSender`'s SendTask* error classification (design §3) — the only
 * real logic in this adapter beyond a pass-through SDK call. Hand-written fake `SFNClient`
 * (`send` throws/resolves per test), no `vi.mock`, matching this repo's adapter-testing
 * convention (thin AWS SDK wrappers with real branching logic get a focused unit test; pure
 * pass-through wrappers like `KmsTokenEncryptor`/`SfnExtractionExecutionStarter` do not). */
import { describe, it, expect } from "vitest";
import { SfnTaskTokenSender } from "../../../src/modules/extraction/persistence/sfn-task-token-sender.js";

interface FakeSfnClient {
  send: (cmd: unknown) => Promise<unknown>;
}

function makeClient(behavior: (cmd: unknown) => Promise<unknown>): FakeSfnClient {
  return { send: behavior };
}

function errorNamed(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

describe("SfnTaskTokenSender", () => {
  it("returns SENT on a successful SendTaskSuccess", async () => {
    const sender = new SfnTaskTokenSender(makeClient(async () => ({})) as never);
    await expect(sender.sendTaskSuccess("token", { ok: true })).resolves.toBe("SENT");
  });

  it("returns SENT on a successful SendTaskFailure", async () => {
    const sender = new SfnTaskTokenSender(makeClient(async () => ({})) as never);
    await expect(sender.sendTaskFailure("token", "SomeError")).resolves.toBe("SENT");
  });

  it.each(["TaskTimedOut", "TaskDoesNotExist"])("classifies %s as TERMINAL_QUIET", async (name) => {
    const sender = new SfnTaskTokenSender(
      makeClient(async () => {
        throw errorNamed(name);
      }) as never,
    );
    await expect(sender.sendTaskSuccess("token", {})).resolves.toBe("TERMINAL_QUIET");
  });

  it("classifies InvalidToken as TERMINAL_WARN_INVALID_TOKEN", async () => {
    const sender = new SfnTaskTokenSender(
      makeClient(async () => {
        throw errorNamed("InvalidToken");
      }) as never,
    );
    await expect(sender.sendTaskFailure("token", "SomeError")).resolves.toBe("TERMINAL_WARN_INVALID_TOKEN");
  });

  it("rethrows any other SendTask* error (e.g. throttling) untouched", async () => {
    const sender = new SfnTaskTokenSender(
      makeClient(async () => {
        throw errorNamed("ThrottlingException");
      }) as never,
    );
    await expect(sender.sendTaskSuccess("token", {})).rejects.toMatchObject({ name: "ThrottlingException" });
  });
});
