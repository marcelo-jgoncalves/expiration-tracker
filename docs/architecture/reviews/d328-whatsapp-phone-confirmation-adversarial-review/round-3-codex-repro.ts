import assert from 'node:assert/strict';
import { InMemoryNotificationStore } from '../../../../test/unit/notification/in-memory-store.js';
import { InMemoryIdentityStore } from '../../../../test/unit/identity/in-memory-store.js';
import { WhatsAppPhoneConfirmationService } from '../../../../src/modules/notification/application/whatsapp-phone-confirmation-service.js';
import { WhatsAppOptInService } from '../../../../src/modules/notification/application/whatsapp-opt-in-service.js';
import { GlobalUserRepository } from '../../../../src/modules/identity/persistence/global-user-repository.js';
import { whatsAppPhoneConfirmationKey, whatsAppConfirmationCodeMatches, type WhatsAppPhoneConfirmation } from '../../../../src/modules/notification/domain/whatsapp-phone-confirmation.js';
import type { RequestContext } from '../../../../src/modules/identity/domain/request-context.js';
const phone = '+15551234567';
const key = whatsAppPhoneConfirmationKey('t1', 'u1', phone);
const ctx = {principal: {userId:'u1'}, tenant:{tenantId:'t1',roles:['OWNER']}, correlationId:'c1'} as RequestContext;
function gate() { let release!: () => void; const promise = new Promise<void>(r => {release=r;}); return {promise,release}; }
function setup() {
  const store = new InMemoryNotificationStore();
  let now = '2026-09-23T00:00:00.000Z';
  const codes: string[] = [];
  const calls: string[] = [];
  const provider = {send: async (input: any) => {codes.push(input.templateParams[0]); return {providerMessageId:'m1'};}};
  const service = new WhatsAppPhoneConfirmationService({store, whatsAppOptIn:new WhatsAppOptInService({store,now:()=>now}), globalUsers:{setPhoneNumber:async (_u,p)=>{calls.push(p); return {} as never;}},tableName:'MainTable',whatsAppProvider:provider,pepper:'p',isWhatsAppChannelEnabled:async()=>true,now:()=>now});
  return {store,service,provider,codes,calls,time:(v:string)=>{now=v;},read:()=>store.get<WhatsAppPhoneConfirmation>(key)};
}
async function wrong(s:ReturnType<typeof setup>) {
  const code = s.codes[0] === '000000' ? '000001' : '000000';
  await assert.rejects(s.service.confirmPhone(ctx,phone,code));
}
function pauseNextWrite(store: {transactWrite: (...args:any[])=>Promise<void>}) {
  const entered=gate(), resume=gate();
  const original=store.transactWrite.bind(store);
  let first=true;
  store.transactWrite=async (...args:any[])=>{if(first){first=false;entered.release();await resume.promise;}return original(...args);};
  return {entered:entered.promise,resume:resume.release};
}
// Counterexample: condition the resend write on its original version to make this assertion fail.
{
 const s=setup(); await s.service.requestConfirmation(ctx,phone); const old=s.codes[0]!;
 s.time('2026-09-23T00:01:01.000Z');
 const sent=gate(), release=gate(); const send=s.provider.send;
 s.provider.send=async input=>{const result=await send(input);sent.release();await release.promise;return result;};
 const resend=s.service.requestConfirmation(ctx,phone);await sent.promise;
 await wrong(s); assert.equal((await s.read())!.version,2);
 const pause=pauseNextWrite(s.store);const confirm=s.service.confirmPhone(ctx,phone,old);await pause.entered;
 release.release();await resend;
 assert.equal((await s.read())!.version,2);
 assert.equal(whatsAppConfirmationCodeMatches('p',old,(await s.read())!.codeHash),false);
 pause.resume();await confirm;
 assert.ok((await s.read())!.confirmedAt);assert.equal(s.calls.length,1);
 console.log('REPRO 1: old code confirmed a different challenge after delayed resend reused version 2');
}
// Counterexample: revalidate the attempt budget after conflict to make this assertion fail.
{
 const s=setup();await s.service.requestConfirmation(ctx,phone);for(let i=0;i<4;i++)await wrong(s);
 const pause=pauseNextWrite(s.store);const confirm=s.service.confirmPhone(ctx,phone,s.codes[0]!);await pause.entered;
 await wrong(s);assert.equal((await s.read())!.attemptCount,5);
 pause.resume();await confirm;
 assert.ok((await s.read())!.confirmedAt);
 console.log('REPRO 2: correct confirmation retried and succeeded with attemptCount=5');
}
// Counterexample: revalidate expiry on retry to make this assertion fail.
{
 const s=setup();await s.service.requestConfirmation(ctx,phone);
 const pause=pauseNextWrite(s.store);const confirm=s.service.confirmPhone(ctx,phone,s.codes[0]!);await pause.entered;
 await wrong(s);s.time('2026-09-23T00:11:00.000Z');pause.resume();await confirm;
 assert.ok((await s.read())!.confirmedAt);
 console.log('REPRO 3: retry confirmed expired challenge using cached now');
}
function identity() {
 const store=new InMemoryIdentityStore();let now='2026-09-23T00:00:00.000Z';
 store.seedRaw({PK:'USER#u1',SK:'PROFILE',entityType:'GlobalUser',userId:'u1',emailNormalized:'a@b.com',identityStatus:'ACTIVE',createdAt:now,updatedAt:now,version:1});
 return {store,repo:new GlobalUserRepository(store,()=>now),time:(v:string)=>{now=v;}};
}
// Counterexample: reserve the remaining attempt atomically before verification.
{
 const s=setup();await s.service.requestConfirmation(ctx,phone);for(let i=0;i<4;i++)await wrong(s);
 const guesses=Array.from({length:10},(_,i)=>(i+100).toString().padStart(6,'0')).filter(code=>code!==s.codes[0]);
 const results=await Promise.allSettled(guesses.map(code=>s.service.confirmPhone(ctx,phone,code)));
 assert.ok(results.every(r=>r.status==='rejected'));assert.ok((await s.read())!.attemptCount>5);
 console.log('REPRO 6: ten concurrent distinct wrong guesses with one remaining slot; final attemptCount='+(await s.read())!.attemptCount);
}
{
 const s=setup();await s.service.requestConfirmation(ctx,phone);await s.service.confirmPhone(ctx,phone,s.codes[0]!);
 s.time('2026-09-24T00:00:00.000Z');await assert.rejects(s.service.confirmPhone(ctx,phone,s.codes[0]!));assert.equal(s.calls.length,1);
 console.log('POSITIVE: already-confirmed code rejected at +24h without setting phone again');
}
// Counterexample: propagate retry exhaustion to make this assertion fail.
{
 const {store,repo}=identity();const tx=store.transactWrite.bind(store);let nested=false,n=0;
 store.transactWrite=async entries=>{if(!nested){nested=true;n++;await repo.setPhoneNumber('u1',phone,'MainTable');nested=false;}await tx(entries);};
 await repo.logoutAll('u1','MainTable');assert.equal(n,5);assert.equal((await repo.get('u1'))!.globalLogoutAfter,undefined);
 console.log('REPRO 4: logoutAll resolved after 5 real phone writes caused conflicts; no revocation persisted');
}
// Counterexample: preserve max(existing watermark, requested watermark) to make this assertion fail.
{
 const s=identity();const pause=pauseNextWrite(s.store);const older=s.repo.logoutAll('u1','MainTable');await pause.entered;
 s.time('2026-09-23T00:01:00.000Z');await s.repo.logoutAll('u1','MainTable');
 assert.equal((await s.repo.get('u1'))!.globalLogoutAfter,'2026-09-23T00:01:00.000Z');
 pause.resume();await older;assert.equal((await s.repo.get('u1'))!.globalLogoutAfter,'2026-09-23T00:00:00.000Z');
 console.log('REPRO 5: older logout retried and moved revocation watermark backwards by 60 seconds');
}
