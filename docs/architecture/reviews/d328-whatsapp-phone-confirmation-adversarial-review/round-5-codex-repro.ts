import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { InMemoryNotificationStore } from '../../../../test/unit/notification/in-memory-store.js';
import { WhatsAppPhoneConfirmationService } from '../../../../src/modules/notification/application/whatsapp-phone-confirmation-service.js';
import { WhatsAppOptInService } from '../../../../src/modules/notification/application/whatsapp-opt-in-service.js';
import { whatsAppPhoneConfirmationKey, whatsAppConfirmationCodeMatches, type WhatsAppPhoneConfirmation } from '../../../../src/modules/notification/domain/whatsapp-phone-confirmation.js';
import { ValidationError } from '../../../../src/shared/errors/app-error.js';
import type { RequestContext } from '../../../../src/modules/identity/domain/request-context.js';

const phone = '+15551234567';
const key = whatsAppPhoneConfirmationKey('t1', 'u1', phone);
const ctx = { principal: { userId: 'u1' }, tenant: { tenantId: 't1', roles: ['OWNER'] }, correlationId: 'c1' } as RequestContext;
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function setup() {
  const store = new InMemoryNotificationStore();
  let now = '2026-09-23T00:00:00.000Z';
  const codes: string[] = [], calls: string[] = [];
  const provider = { send: async (input: any) => { codes.push(input.templateParams[0]); return { providerMessageId: 'm1' }; } };
  const service = new WhatsAppPhoneConfirmationService({ store, whatsAppOptIn: new WhatsAppOptInService({ store, now: () => now }), globalUsers: { setPhoneNumber: async (_u, p) => { calls.push(p); return {} as never; } }, tableName: 'MainTable', whatsAppProvider: provider, pepper: 'p', isWhatsAppChannelEnabled: async () => true, now: () => now });
  return { store, service, provider, codes, calls, time: (v: string) => { now = v; }, read: () => store.get<WhatsAppPhoneConfirmation>(key) };
}
function pauseNext(store: any, method: string) {
  const entered = gate(), resume = gate(), original = store[method].bind(store);
  let first = true;
  store[method] = async (...args: any[]) => {
    if (first) { first = false; entered.release(); await resume.promise; }
    return original(...args);
  };
  return { entered: entered.promise, resume: resume.release };
}

// Reversing the expiry/confirmedAt checks makes the rejected call succeed.
{
  const s = setup(); await s.service.requestConfirmation(ctx, phone);
  s.time('2026-09-23T00:09:59.000Z');
  const pause = pauseNext(s.store, 'transactWrite');
  const pending = s.service.confirmPhone(ctx, phone, s.codes[0]!);
  const rejected = assert.rejects(pending, ValidationError);
  await pause.entered;
  await s.service.confirmPhone(ctx, phone, s.codes[0]!);
  s.time('2026-09-23T00:10:01.000Z');
  pause.resume(); await rejected;
  assert.equal(s.calls.length, 1);
  console.log('PASS R4-1: duplicate rejects at expiry boundary without repeated phone write');
}
// Removing early validation sends to an invalid recipient.
{
  const s = setup();
  await assert.rejects(s.service.requestConfirmation(ctx, 'invalid'), ValidationError);
  assert.equal(s.codes.length, 0);
  console.log('PASS R4-3: invalid E.164 never reaches provider');
}

const originalRandomInt = crypto.randomInt;
let sequence: number[] = [];
crypto.randomInt = (() => { assert.ok(sequence.length); return sequence.shift()!; }) as typeof crypto.randomInt;
syncBuiltinESMExports();
try {
  // Without adoption, the loser regresses createdAt and the immediate resend succeeds.
  for (const creation of [false, true]) {
    sequence = [111111, 222222, 333333];
    const s = setup();
    if (!creation) await s.service.requestConfirmation(ctx, phone);
    s.time('2026-09-23T00:01:01.000Z');
    const pause = pauseNext(s.store, creation ? 'putIfAbsent' : 'transactWrite');
    const pending = s.service.requestConfirmation(ctx, phone); await pause.entered;
    s.time('2026-09-23T00:02:02.000Z');
    const winner = await s.service.requestConfirmation(ctx, phone);
    const before = { ...(await s.read())! };
    pause.resume(); assert.deepEqual(await pending, winner);
    assert.deepEqual(await s.read(), before);
    await assert.rejects(s.service.requestConfirmation(ctx, phone), ValidationError);
    console.log('PASS R4-2: adopts concurrent winner and retains cooldown (' + (creation ? 'creation' : 'resend') + ')');
  }
  // An older request can win persistence after the newer request sends, yet before its write.
  {
    sequence = [111111, 222222, 333333];
    const s = setup(); await s.service.requestConfirmation(ctx, phone);
    s.time('2026-09-23T00:01:01.000Z');
    const olderPause = pauseNext(s.store, 'transactWrite');
    const older = s.service.requestConfirmation(ctx, phone); await olderPause.entered;
    s.time('2026-09-23T00:01:02.000Z');
    const newerPause = pauseNext(s.store, 'transactWrite');
    const newer = s.service.requestConfirmation(ctx, phone); await newerPause.entered;
    olderPause.resume(); const result = await older;
    newerPause.resume(); assert.deepEqual(await newer, result);
    const record = (await s.read())!;
    assert.equal(record.createdAt, '2026-09-23T00:01:01.000Z');
    assert.ok(whatsAppConfirmationCodeMatches('p', '222222', record.codeHash));
    assert.ok(!whatsAppConfirmationCodeMatches('p', '333333', record.codeHash));
    console.log('CONFIRMED: older request wins; latest sent code is invalid');
  }
  // Equal six-digit codes are valid random outcomes; hashes cannot identify challenge generations.
  {
    sequence = [111111, 222222, 111111, 444444];
    const s = setup(); await s.service.requestConfirmation(ctx, phone);
    s.time('2026-09-23T00:01:01.000Z');
    const pause = pauseNext(s.store, 'transactWrite');
    const older = s.service.requestConfirmation(ctx, phone); await pause.entered;
    s.time('2026-09-23T00:02:02.000Z');
    await s.service.requestConfirmation(ctx, phone);
    assert.equal((await s.read())!.createdAt, '2026-09-23T00:02:02.000Z');
    pause.resume(); await older;
    assert.equal((await s.read())!.createdAt, '2026-09-23T00:01:01.000Z');
    await s.service.requestConfirmation(ctx, phone);
    assert.equal(s.codes.length, 4);
    console.log('RESIDUAL R4-2: repeated original code defeats adoption, regresses createdAt, permits immediate resend');
  }
} finally {
  crypto.randomInt = originalRandomInt;
  syncBuiltinESMExports();
}
