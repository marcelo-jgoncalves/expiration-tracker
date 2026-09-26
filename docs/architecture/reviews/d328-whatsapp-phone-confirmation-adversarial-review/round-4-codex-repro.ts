import assert from 'node:assert/strict';
import { InMemoryNotificationStore } from '../../../../test/unit/notification/in-memory-store.js';
import { InMemoryIdentityStore } from '../../../../test/unit/identity/in-memory-store.js';
import { WhatsAppPhoneConfirmationService } from '../../../../src/modules/notification/application/whatsapp-phone-confirmation-service.js';
import { WhatsAppOptInService } from '../../../../src/modules/notification/application/whatsapp-opt-in-service.js';
import { GlobalUserRepository } from '../../../../src/modules/identity/persistence/global-user-repository.js';
import { whatsAppPhoneConfirmationKey, whatsAppConfirmationCodeMatches, type WhatsAppPhoneConfirmation } from '../../../../src/modules/notification/domain/whatsapp-phone-confirmation.js';
import { DependencyUnavailableError, ValidationError } from '../../../../src/shared/errors/app-error.js';
import type { RequestContext } from '../../../../src/modules/identity/domain/request-context.js';
const phone = '+15551234567';
const key = whatsAppPhoneConfirmationKey('t1', 'u1', phone);
const ctx = {principal: {userId:'u1'}, tenant:{tenantId:'t1',roles:['OWNER']}, correlationId:'c1'} as RequestContext;
function gate() { let release!: () => void; const promise = new Promise<void>(r => {release=r;}); return {promise,release}; }
function setup() {
  const store = new InMemoryNotificationStore();
  let now = '2026-09-23T00:00:00.000Z';
  const codes: string[] = [], calls: string[] = [];
  const provider = {send: async (input: any) => {codes.push(input.templateParams[0]); return {providerMessageId:'m1'};}};
  const service = new WhatsAppPhoneConfirmationService({store, whatsAppOptIn:new WhatsAppOptInService({store,now:()=>now}), globalUsers:{setPhoneNumber:async (_u,p)=>{calls.push(p); return {} as never;}},tableName:'MainTable',whatsAppProvider:provider,pepper:'p',isWhatsAppChannelEnabled:async()=>true,now:()=>now});
  return {store,service,provider,codes,calls,time:(v:string)=>{now=v;},read:()=>store.get<WhatsAppPhoneConfirmation>(key)};
}
async function wrong(s:ReturnType<typeof setup>) {
  await assert.rejects(s.service.confirmPhone(ctx,phone,s.codes[0] === '000000' ? '000001' : '000000'),ValidationError);
}
function pauseNextWrite(store: {transactWrite: (...args:any[])=>Promise<void>}) {
  const entered=gate(), resume=gate(), original=store.transactWrite.bind(store);
  let first=true;
  store.transactWrite=async (...args:any[])=>{if(first){first=false;entered.release();await resume.promise;}return original(...args);};
  return {entered:entered.promise,resume:resume.release};
}
// Regression: an unconditional resend would reuse v2 and accept the pending old confirmation.
{
 const s=setup(); await s.service.requestConfirmation(ctx,phone); const old=s.codes[0]!;
 s.time('2026-09-23T00:01:01.000Z');
 const sent=gate(), release=gate(); const send=s.provider.send;
 s.provider.send=async input=>{const result=await send(input);sent.release();await release.promise;return result;};
 const resend=s.service.requestConfirmation(ctx,phone);await sent.promise;
 await wrong(s);assert.equal((await s.read())!.version,2);
 const pause=pauseNextWrite(s.store);const confirm=s.service.confirmPhone(ctx,phone,old);
 const rejected=assert.rejects(confirm,ValidationError);await pause.entered;
 release.release();await resend;assert.equal((await s.read())!.version,3);
 assert.equal(whatsAppConfirmationCodeMatches('p',old,(await s.read())!.codeHash),false);
 pause.resume();await rejected;assert.equal((await s.read())!.confirmedAt,undefined);assert.equal(s.calls.length,0);
 console.log('CLOSED 1: exact three-actor old-code/new-challenge collision rejected');
}
// Regression: removing the budget gate allows more than five increments.
{
 const s=setup();await s.service.requestConfirmation(ctx,phone);for(let i=0;i<4;i++)await wrong(s);
 const results=await Promise.allSettled(Array.from({length:10},()=>wrong(s)));
 assert.ok(results.every(r=>r.status==='fulfilled'));assert.equal((await s.read())!.attemptCount,5);
 console.log('CLOSED 2: ten concurrent wrong guesses stop at attemptCount=5');
}
// Regression: accepting an exhausted budget or using the initial clock would resolve these calls.
for (const expire of [false,true]) {
 const s=setup();await s.service.requestConfirmation(ctx,phone);
 if(!expire)for(let i=0;i<4;i++)await wrong(s);
 const pause=pauseNextWrite(s.store), confirm=s.service.confirmPhone(ctx,phone,s.codes[0]!);
 const rejected=assert.rejects(confirm,ValidationError);await pause.entered;await wrong(s);
 if(expire)s.time('2026-09-23T00:11:00.000Z');pause.resume();await rejected;
 assert.equal(s.calls.length,0);
 console.log('CLOSED: retry rejects '+(expire?'expired unconfirmed challenge':'exhausted attempt budget'));
}
function identity() {
 const store=new InMemoryIdentityStore();let now='2026-09-23T00:00:00.000Z';
 store.seedRaw({PK:'USER#u1',SK:'PROFILE',entityType:'GlobalUser',userId:'u1',emailNormalized:'a@b.com',identityStatus:'ACTIVE',createdAt:now,updatedAt:now,version:1});
 return {store,repo:new GlobalUserRepository(store,()=>now),time:(v:string)=>{now=v;}};
}
// Regression: silent exhaustion would resolve without persisting any watermark.
{
 const {store,repo}=identity();const tx=store.transactWrite.bind(store);let nested=false,n=0;
 store.transactWrite=async entries=>{if(!nested){nested=true;n++;await repo.setPhoneNumber('u1',phone,'MainTable');nested=false;}await tx(entries);};
 await assert.rejects(repo.logoutAll('u1','MainTable'),DependencyUnavailableError);
 assert.equal(n,5);assert.equal((await repo.get('u1'))!.globalLogoutAfter,undefined);
 console.log('CLOSED 4: five real competing phone writes cause explicit logout failure');
}
// Regression: dropping the maximum-watermark guard would overwrite the newest logout.
{
 const s=identity(),pause=pauseNextWrite(s.store),older=s.repo.logoutAll('u1','MainTable');await pause.entered;
 s.time('2026-09-23T00:01:00.000Z');await s.repo.logoutAll('u1','MainTable');
 s.time('2026-09-23T00:02:00.000Z');await s.repo.logoutAll('u1','MainTable');
 pause.resume();await older;assert.equal((await s.repo.get('u1'))!.globalLogoutAfter,'2026-09-23T00:02:00.000Z');
 console.log('CLOSED 5: three logout actors preserve maximum watermark');
}
// Counterexample: checking expiry before the fresh.confirmedAt shortcut would reject the pending call.
{
 const s=setup();await s.service.requestConfirmation(ctx,phone);
 s.time('2026-09-23T00:09:59.000Z');
 const pause=pauseNextWrite(s.store),pending=s.service.confirmPhone(ctx,phone,s.codes[0]!);await pause.entered;
 await s.service.confirmPhone(ctx,phone,s.codes[0]!);assert.equal(s.calls.length,1);
 const otherPhone='+15559999999';await s.service.requestConfirmation(ctx,otherPhone);
 await s.service.confirmPhone(ctx,otherPhone,s.codes[1]!);assert.equal(s.calls.at(-1),otherPhone);
 s.time('2026-09-23T00:10:01.000Z');pause.resume();await pending;
 assert.equal(s.calls.length,3);assert.equal(s.calls.at(-1),phone);
 console.log('OPEN 1: retry at +10m1s finds confirmedAt and restores old phone A after B was confirmed, despite A expiry');
}
// Counterexample: reserving the cooldown before sending would prevent both same-time requests from sending.
{
 const s=setup();await s.service.requestConfirmation(ctx,phone);s.time('2026-09-23T00:01:01.000Z');
 const pause=pauseNextWrite(s.store),first=s.service.requestConfirmation(ctx,phone);await pause.entered;
 await s.service.requestConfirmation(ctx,phone);pause.resume();await first;
 assert.equal(s.codes.length,3);assert.equal((await s.read())!.version,3);
 console.log('OPEN 2a: two same-time resends both succeed and send; cooldown not enforced on retry');
}
// Counterexample: a stale resend must not restore its old creation time after a newer resend wins.
{
 const s=setup();await s.service.requestConfirmation(ctx,phone);s.time('2026-09-23T00:01:01.000Z');
 const pause=pauseNextWrite(s.store),first=s.service.requestConfirmation(ctx,phone);await pause.entered;
 s.time('2026-09-23T00:02:02.000Z');await s.service.requestConfirmation(ctx,phone);
 assert.equal((await s.read())!.createdAt,'2026-09-23T00:02:02.000Z');pause.resume();await first;
 assert.equal((await s.read())!.createdAt,'2026-09-23T00:01:01.000Z');
 await s.service.requestConfirmation(ctx,phone);assert.equal(s.codes.length,4);
 console.log('OPEN 2b: stale resend moves createdAt backwards 61s, allowing another immediate send');
}
// Counterexample: validating E.164 before provider.send would leave the send counter at zero.
{
 const s=setup();await assert.rejects(s.service.requestConfirmation(ctx,'invalid-phone'),ValidationError);
 assert.equal(s.codes.length,1);
 console.log('OPEN 3: invalid E.164 invokes provider.send before domain validation rejects it (service boundary)');
}
// Mutation probe: the submitted budget-test oracle accepts a complete no-op increment helper.
{
 const s=setup();await s.service.requestConfirmation(ctx,phone);
 const realGet=s.store.get.bind(s.store),snapshot={...(await s.read())!,attemptCount:4};let remaining=10;
 s.store.get=(async (k:any)=>{if(remaining>0&&k.PK===key.PK&&k.SK===key.SK){remaining--;return snapshot;}return realGet(k);}) as typeof s.store.get;
 (s.service as any).incrementAttemptCountWithRetry=async()=>{};
 const guesses=Array.from({length:10},(_,i)=>(i===0?'999998':String(100000+i))).filter(c=>c!==s.codes[0]);
 const results=await Promise.allSettled(guesses.map(c=>s.service.confirmPhone(ctx,phone,c)));
 assert.ok(results.every(r=>r.status==='rejected'));const record=await realGet<WhatsAppPhoneConfirmation>(key);
 assert.ok(record!.attemptCount<=5);assert.equal(record!.attemptCount,0);
 console.log('COVERAGE: exact submitted budget oracle survives a runtime no-op mutation; stored attemptCount remains 0');
}
