// Seed `dev` with realistic, varied demo data so every real screen shows populated content
// (Marcelo, 2026-09-26: "eu quero que todas as telas tenham conteúdo para eu ver o resultado
// completo"). One-off/re-runnable operator script, NOT wired into CI/CD - same posture as
// scripts/reset-dev-data.ts (manual invocation only).
//
// Creates a brand-new, clearly-labeled demo organization (never touches Marcelo's own real
// account/org) via a dedicated Cognito user (admin-created, same pattern
// docs/engineering/performance/traces/perf-11b-multi-tenant-setup.mjs already used for synthetic
// load-test tenants), then drives the REAL app through its real HTTP API (BFF session cookies via
// a real Playwright login, never a direct DynamoDB write) so every record is created exactly the
// way the application itself creates it - real validation, real OCC, real side effects.
//
// Usage:
//   node scripts/seed-dev-demo-data.mjs --confirm [--phase=1,2,3]
// (--phase limits to specific phases, comma-separated, for resuming after a partial failure -
// see PHASES below for the numbering. Omit for all phases in order.)
//
// Safety: hardcoded to the known `dev` CloudFront origin/Cognito pool - never a free parameter.
// Dry-run (no --confirm) only prints the plan, no writes.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL = path.join(ROOT, ".local-artifacts", "omnivence-demo-seed");
const ORIGIN = "https://d1mbs2t047qo9d.cloudfront.net";
const STATE_PATH = path.join(LOCAL, "state.json");
const ERRORS_PATH = path.join(LOCAL, "errors.json");

const CONFIRM = process.argv.includes("--confirm");
const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const ONLY_PHASES = phaseArg ? new Set(phaseArg.slice("--phase=".length).split(",").map(Number)) : null;

if (!existsSync(LOCAL)) mkdirSync(LOCAL, { recursive: true });

const log = (msg, extra) => console.log(`[${new Date().toISOString()}] ${msg}`, extra ? JSON.stringify(extra) : "");
const errors = [];
function recordError(phase, action, detail) {
  const entry = { phase, action, detail, at: new Date().toISOString() };
  errors.push(entry);
  console.error(`[ERRO] fase ${phase} — ${action}:`, detail);
}

function loadState() {
  return existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {};
}
function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function main() {
  if (!CONFIRM) {
    console.log("DRY RUN (sem --confirm). Nenhuma escrita será feita. Fases planejadas:");
    for (const [n, desc] of Object.entries(PHASE_DESCRIPTIONS)) console.log(`  ${n}. ${desc}`);
    return;
  }

  const { chromium } = await import(pathToFileURL(path.resolve(ROOT, "frontend/node_modules/playwright/index.mjs")).href);
  const browser = await chromium.launch();
  const state = loadState();
  state.organizationName = state.organizationName ?? "OmniVence Demo — Catálogo Completo";

  try {
    for (const phase of PHASES) {
      if (ONLY_PHASES && !ONLY_PHASES.has(phase.n)) continue;
      log(`=== Fase ${phase.n}: ${phase.desc} ===`);
      try {
        await phase.run(browser, state);
        saveState(state);
      } catch (err) {
        recordError(phase.n, phase.desc, err?.stack ?? String(err));
        saveState(state);
      }
    }
  } finally {
    await browser.close();
  }

  writeFileSync(ERRORS_PATH, JSON.stringify(errors, null, 2));
  log(`Concluído. ${errors.length} erro(s) registrado(s) em ${ERRORS_PATH}.`);
  if (errors.length > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------------------------------------
// HTTP helpers - same convention as perf-11b-multi-tenant-setup.mjs: real Playwright login for
// real session/CSRF cookies, then page.evaluate(fetch(...)) so every call runs from the app's own
// origin (no CORS workaround needed) exactly like a real browser tab would.
// ---------------------------------------------------------------------------------------------

// D-321/D-320 real finding (2026-09-26): the perf scripts' own login() (perf-reminder-burst.mjs,
// perf-11b-multi-tenant-setup.mjs) navigate to `/bff/login?returnTo=/` and wait for
// `#signInFormUsername`/`#signInFormPassword`/`input[name='signInSubmitButton']` - the Cognito
// Hosted UI's OWN field ids. D-321 replaced Hosted UI with this app's real login screen
// (`Login.tsx`, real fields `#login-email`/`#login-password`, route `/login?returnTo=/`) - those
// scripts have been silently stale since then (would time out identically if run today, same
// failure this script hit before this fix). Registered as a real, separate finding - not fixed
// in the perf scripts themselves here (out of this task's scope), just avoided in this new one.
async function login(browser, email, password) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/login?returnTo=/`, { waitUntil: "networkidle" });
  await page.locator("#login-email").waitFor({ state: "visible", timeout: 20000 });
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.locator("button.ov-login-submit").click();
  await page.waitForURL((url) => url.origin === ORIGIN && !url.pathname.startsWith("/login"), { timeout: 30000 });
  const cookies = await context.cookies(ORIGIN);
  const csrfToken = cookies.find((c) => c.name === "__Host-et_csrf")?.value;
  if (!csrfToken) throw new Error("Sem cookie CSRF após login: " + cookies.map((c) => c.name).join(","));
  return { context, page, csrfToken };
}

// `expectedVersion` (OCC) - most document-archive mutations carry it body-side (already folded
// into `body` by the caller when needed, per that module's own convention, confirmed against
// documentTypes.ts/documentArchive.ts/documentRequests.ts doc comments), but subject/item/
// reminder-policy mutations (the legacy/expiration modules) require it as a REAL `If-Match`
// header instead (`requireExpectedVersion()` in subject-handlers.ts, `items.ts`'s own
// `{ expectedVersion }` request option) - a missing header there is a hard 400, not optional.
// `apiClient.ts`'s real baseUrl is `/bff/api` for every route in src/api/*.ts (items, subjects,
// document-archive/*, notifications/*, organizations/members, reminders/policies, etc.) - the
// ONE exception is `POST /bff/organizations` itself (`organizations.ts`'s `createOrganization`
// deliberately bypasses `apiClient` and calls `fetch("/bff/organizations", ...)` directly,
// outside the `/api` prefix). Real finding, caught by this script's own first live run
// (2026-09-26): every non-org call below 403'd at the CloudFront layer ("not configured to
// allow the HTTP request method") because the path was missing this prefix entirely and landed
// on the SPA static-content cache behavior instead of the API behavior - not an app bug, a bug
// in this script's own path-building, fixed here before any further phase ran.
const API_PREFIX = "/bff/api";
async function apiCall(page, method, urlPath, body, csrfToken, organizationId, { expectedVersion, idempotencyKey, raw } = {}) {
  const fullPath = raw ? urlPath : API_PREFIX + urlPath;
  const result = await page.evaluate(
    async ({ method, fullPath, body, csrfToken, origin, organizationId, expectedVersion, idempotencyKey }) => {
      const headers = { "content-type": "application/json", "x-csrf-token": csrfToken };
      if (organizationId) headers["x-organization-id"] = organizationId;
      if (expectedVersion !== undefined) headers["if-match"] = String(expectedVersion);
      if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
      const res = await fetch(origin + fullPath, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "include" });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
      return { status: res.status, json };
    },
    { method, fullPath, body, csrfToken, origin: ORIGIN, organizationId, expectedVersion, idempotencyKey },
  );
  return result;
}

function requireOk(result, action) {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${action} falhou: HTTP ${result.status} — ${JSON.stringify(result.json)}`);
  }
  return result.json;
}

// A tiny 1x1 PNG, valid bytes, real checksum computed at upload time - enough to exercise the
// real 3-step upload pipeline (reserve/files/commit) without needing a realistic-looking scan.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function sha256Hex(buffer) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(buffer).digest("hex");
}

// ---------------------------------------------------------------------------------------------
// Phase definitions
// ---------------------------------------------------------------------------------------------

const PHASE_DESCRIPTIONS = {
  0: "Login do usuário demo + criação da organização",
  1: "Tipos de documento (A20)",
  2: "Fornecedores/Clientes (Subjects), incluindo arquivados",
  3: "Requisitos documentais por fornecedor (aplicabilidade variada)",
  4: "Upload real de evidência + revisão (A12/A13) para alguns requisitos",
  5: "Vencimentos/Itens variados + renovação + política de lembrete customizada",
  6: "Séries recorrentes + solicitações avulsas (A14) + materialização",
  7: "Membros adicionais (papéis variados) + convite pendente",
  8: "Preferências de notificação + entrega de solicitação (A22) + template de requisito",
};

const PHASES = [
  { n: 0, desc: PHASE_DESCRIPTIONS[0], run: phase0 },
  { n: 1, desc: PHASE_DESCRIPTIONS[1], run: phase1 },
  { n: 2, desc: PHASE_DESCRIPTIONS[2], run: phase2 },
  { n: 3, desc: PHASE_DESCRIPTIONS[3], run: phase3 },
  { n: 4, desc: PHASE_DESCRIPTIONS[4], run: phase4 },
  { n: 5, desc: PHASE_DESCRIPTIONS[5], run: phase5 },
  { n: 6, desc: PHASE_DESCRIPTIONS[6], run: phase6 },
  { n: 7, desc: PHASE_DESCRIPTIONS[7], run: phase7 },
  { n: 8, desc: PHASE_DESCRIPTIONS[8], run: phase8 },
];

async function phase0(browser, state) {
  const creds = Object.fromEntries(
    readFileSync(path.join(LOCAL, "credentials.txt"), "utf8")
      .split(/\r?\n/)
      .flatMap((line) => {
        const m = /^(\w+)=(.*)$/.exec(line);
        return m ? [[m[1], m[2].trim()]] : [];
      }),
  );
  const { context, page, csrfToken } = await login(browser, creds.email, creds.password);
  state.email = creds.email;
  state.cookies = await context.cookies(ORIGIN);
  state.cookieHeader = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  if (!state.organizationId) {
    const created = requireOk(
      await apiCall(page, "POST", "/bff/organizations", { displayName: state.organizationName, timezone: "America/Sao_Paulo" }, csrfToken, undefined, { raw: true }),
      "criar organização",
    );
    state.organizationId = created.organizationId;
    log("Organização criada", { organizationId: state.organizationId });
  } else {
    log("Organização já existia no state, reutilizando", { organizationId: state.organizationId });
  }

  state._page = null; // never persisted, just marks that a fresh page/context is needed per phase
  await context.close();
}

// Every subsequent phase gets its own fresh authenticated context (Cognito tokens are short-lived
// and phases can run minutes apart) - same reauthenticate-per-phase discipline perf-reminder-
// burst.mjs uses.
async function freshSession(browser) {
  const creds = Object.fromEntries(
    readFileSync(path.join(LOCAL, "credentials.txt"), "utf8")
      .split(/\r?\n/)
      .flatMap((line) => {
        const m = /^(\w+)=(.*)$/.exec(line);
        return m ? [[m[1], m[2].trim()]] : [];
      }),
  );
  return login(browser, creds.email, creds.password);
}

async function phase1(browser, state) {
  const { context, page, csrfToken } = await freshSession(browser, state);
  const orgId = state.organizationId;
  const types = [
    { displayName: "Certidão Negativa de Débitos" },
    { displayName: "Contrato Social" },
    { displayName: "Alvará de Funcionamento" },
    { displayName: "Apólice de Seguro" },
    { displayName: "Comprovante de Endereço" },
    { displayName: "Certificado Digital (a ser descontinuado)" },
  ];
  state.documentTypes = state.documentTypes ?? [];
  for (const input of types) {
    if (state.documentTypes.some((t) => t.displayName === input.displayName)) continue;
    try {
      const created = requireOk(await apiCall(page, "POST", "/document-archive/document-types", input, csrfToken, orgId), `criar tipo de documento "${input.displayName}"`);
      state.documentTypes.push(created.documentType);
      log("Tipo de documento criado", { displayName: input.displayName, id: created.documentType.documentTypeId });
    } catch (err) {
      recordError(1, `criar tipo "${input.displayName}"`, String(err));
    }
  }
  // Deprecate the last one, for "1 DEPRECATED" visual variety in the catalog screen.
  const toDeprecate = state.documentTypes.find((t) => t.displayName.includes("a ser descontinuado"));
  if (toDeprecate && toDeprecate.status !== "DEPRECATED") {
    try {
      const result = requireOk(
        await apiCall(page, "POST", `/document-archive/document-types/${toDeprecate.documentTypeId}/deprecate`, { expectedVersion: toDeprecate.version }, csrfToken, orgId),
        "descontinuar tipo de documento",
      );
      Object.assign(toDeprecate, result.documentType);
      log("Tipo de documento descontinuado", { id: toDeprecate.documentTypeId });
    } catch (err) {
      recordError(1, "descontinuar tipo de documento", String(err));
    }
  }
  await context.close();
}

async function phase2(browser, state) {
  const { context, page, csrfToken } = await freshSession(browser, state);
  const orgId = state.organizationId;
  const subjectsPlan = [
    { type: "VENDOR", displayName: "Comércio Vale Verde Ltda", externalId: "12.345.678/0001-90", archive: false },
    { type: "VENDOR", displayName: "Distribuidora Rio Claro ME", externalId: "23.456.789/0001-01", archive: false },
    { type: "VENDOR", displayName: "Transportes Serra Azul S.A.", externalId: undefined, archive: false },
    { type: "VENDOR", displayName: "Facilities Monte Alto Ltda", externalId: "34.567.890/0001-12", archive: true },
    { type: "VENDOR", displayName: "Segurança Patrimonial Norte", externalId: undefined, archive: false },
    { type: "VENDOR", displayName: "Manutenção Predial Sul Ltda", externalId: "45.678.901/0001-23", archive: true },
    { type: "CLIENT", displayName: "Construtora Horizonte Ltda", externalId: "56.789.012/0001-34", archive: false },
    { type: "CLIENT", displayName: "Incorporadora Bela Vista S.A.", externalId: "67.890.123/0001-45", archive: false },
    { type: "CLIENT", displayName: "Escritório Andrade & Costa", externalId: undefined, archive: false },
    { type: "CLIENT", displayName: "Consultoria Tavares Associados", externalId: "78.901.234/0001-56", archive: true },
  ];
  state.subjects = state.subjects ?? [];
  for (const plan of subjectsPlan) {
    if (state.subjects.some((s) => s.displayName === plan.displayName)) continue;
    try {
      const input = { type: plan.type, displayName: plan.displayName, externalId: plan.externalId };
      const created = requireOk(await apiCall(page, "POST", "/subjects", input, csrfToken, orgId), `criar fornecedor "${plan.displayName}"`);
      const subject = created.subject;
      if (plan.archive) {
        const archived = requireOk(
          await apiCall(page, "POST", `/subjects/${subject.subjectId}/archive`, undefined, csrfToken, orgId, { expectedVersion: subject.version }),
          `arquivar "${plan.displayName}"`,
        );
        Object.assign(subject, { status: "ARCHIVED", version: archived.subject?.version ?? subject.version + 1 });
      }
      state.subjects.push(subject);
      log("Fornecedor criado", { displayName: plan.displayName, archived: plan.archive, id: subject.subjectId });
    } catch (err) {
      recordError(2, `criar fornecedor "${plan.displayName}"`, String(err));
    }
  }
  await context.close();
}

async function phase3(browser, state) {
  const { context, page, csrfToken } = await freshSession(browser, state);
  const orgId = state.organizationId;
  state.requirements = state.requirements ?? [];
  // Skip archived subjects for new requirements - focus variety on active ones, but leave the
  // archived subjects with ZERO requirements (a real, valid state worth showing too).
  const activeSubjects = state.subjects.filter((s) => s.status !== "ARCHIVED");
  const requirementNames = ["Certidão Negativa de Débitos Federais", "Contrato Social Atualizado", "Alvará de Funcionamento", "Apólice de Seguro Vigente", "Comprovante de Endereço"];

  for (const [i, subject] of activeSubjects.entries()) {
    // Vary applicability count per subject: subject 0 gets zero APPLICABLE requirements (shows
    // "—" compliance), subject 1 gets all NOT_APPLICABLE (also "—", different reason), the rest
    // get a real mix.
    const plan =
      i === 0
        ? []
        : i === 1
          ? requirementNames.slice(0, 3).map((name) => ({ name, applicability: "NOT_APPLICABLE" }))
          : requirementNames.map((name, j) => ({ name, applicability: j === requirementNames.length - 1 && i % 3 === 0 ? "NOT_APPLICABLE" : "APPLICABLE" }));

    for (const item of plan) {
      const key = `${subject.subjectId}:${item.name}`;
      if (state.requirements.some((r) => r._key === key)) continue;
      try {
        const input = { subjectId: subject.subjectId, name: item.name, applicability: item.applicability };
        const created = requireOk(await apiCall(page, "POST", "/document-archive/requirements", input, csrfToken, orgId), `criar requisito "${item.name}" para "${subject.displayName}"`);
        state.requirements.push({ ...created.requirement, _key: key, _subjectName: subject.displayName });
        log("Requisito criado", { subject: subject.displayName, name: item.name, applicability: item.applicability });
      } catch (err) {
        recordError(3, `criar requisito "${item.name}" para "${subject.displayName}"`, String(err));
      }
    }
  }
  await context.close();
}

async function phase4(browser, state) {
  const { context, page, csrfToken } = await freshSession(browser, state);
  const orgId = state.organizationId;
  if (!state.documentTypes?.length) {
    recordError(4, "upload de evidência", "sem tipos de documento disponíveis (fase 1 falhou?) - fase pulada");
    await context.close();
    return;
  }
  const documentTypeId = state.documentTypes[0].documentTypeId;
  // Try the real 3-step upload pipeline for up to 4 APPLICABLE requirements: reserve document,
  // reserve+upload a file, commit. This alone reaches RECEIVED (visible in the Fila de
  // Revisão/A13 screen) without needing OCR/Bedrock to finish. Then attempt claim+accept on the
  // FIRST one only, to prove (or disprove, and record honestly) whether SATISFIED is reachable
  // this way without a real validity-bearing document - registered explicitly either way.
  const candidates = state.requirements.filter((r) => r.applicability === "APPLICABLE" && !r.evidenceDocumentId).slice(0, 4);
  state.uploadedDocuments = state.uploadedDocuments ?? [];

  const bytes = Buffer.from(TINY_PNG_BASE64, "base64");
  const checksum = await sha256Hex(bytes);

  for (const [idx, req] of candidates.entries()) {
    try {
      const doc = requireOk(
        await apiCall(page, "POST", "/document-archive/documents", { subjectId: req.subjectId, documentTypeId, hasValidity: true }, csrfToken, orgId),
        `criar documento para requisito "${req.name}"`,
      );
      const documentId = doc.document.documentId;

      const reserved = requireOk(await apiCall(page, "POST", `/document-archive/documents/${documentId}/versions`, { origin: "MANUAL_UPLOAD" }, csrfToken, orgId), "reservar versão");
      const seq = reserved.version.seq;
      let expectedVersion = reserved.version.version;

      const filesRes = requireOk(
        await apiCall(
          page,
          "POST",
          `/document-archive/documents/${documentId}/versions/${seq}/files`,
          { expectedVersion, files: [{ role: "PRINCIPAL", mediaType: "image/png", contentLength: bytes.length, checksumSha256: checksum }] },
          csrfToken,
          orgId,
        ),
        "reservar arquivo",
      );
      const fileSpec = filesRes.files[0];

      // Real PUT to the presigned S3 URL, exactly like the browser would, using fetch from
      // Node directly (no page.evaluate needed - S3 has its own CORS/auth via the presigned URL,
      // reachable straight from this script's own network context).
      const putRes = await fetch(fileSpec.uploadUrl, { method: "PUT", headers: fileSpec.requiredHeaders, body: bytes });
      if (!putRes.ok) throw new Error(`PUT do arquivo falhou: HTTP ${putRes.status} — ${await putRes.text()}`);

      const committed = requireOk(await apiCall(page, "POST", `/document-archive/documents/${documentId}/versions/${seq}/commit`, { expectedVersion }, csrfToken, orgId), "commitar versão");
      state.uploadedDocuments.push({ documentId, seq, requirementName: req.name, subjectName: req._subjectName });
      log("Documento enviado (RECEIVED)", { documentId, requirement: req.name });

      if (idx === 0) {
        // Only attempt review on the first one - claim+accept requires docarchive:review
        // (same demo user, OWNER role, should qualify) and we want ONE honest data point on
        // whether this reaches SATISFIED without OCR, not to burn time/AWS cost on all 4.
        try {
          const claimed = requireOk(await apiCall(page, "POST", `/document-archive/documents/${documentId}/versions/${seq}/claim`, { expectedVersion: committed.version.version }, csrfToken, orgId), "reivindicar revisão");
          const accepted = requireOk(
            await apiCall(page, "POST", `/document-archive/documents/${documentId}/versions/${seq}/accept`, { expectedVersion: claimed.version.version, clientRequestToken: randomUUID() }, csrfToken, orgId),
            "aceitar versão",
          );
          log("Versão aceita manualmente (revisão humana, sem OCR)", { documentId, acceptedVersionId: accepted.acceptedVersionId });
          state.manualAcceptWorked = true;
        } catch (err) {
          recordError(4, "aceitar versão manualmente (sem extração/OCR completar)", String(err));
          state.manualAcceptWorked = false;
        }
      }
    } catch (err) {
      recordError(4, `pipeline de upload para requisito "${req.name}"`, String(err));
    }
  }
  await context.close();
}

async function phase5(browser, state) {
  const { context, page, csrfToken } = await freshSession(browser, state);
  const orgId = state.organizationId;
  const now = Date.now();
  const days = (n) => new Date(now + n * 24 * 60 * 60 * 1000).toISOString();
  const itemsPlan = [
    { name: "Licença Ambiental Municipal", category: "Licença", dueDate: days(-30) }, // vencido há muito
    { name: "Certidão de Regularidade FGTS", category: "Certidão", dueDate: days(-2) }, // vencido recente
    { name: "Contrato de Locação Sede", category: "Contrato", dueDate: days(3) }, // vencendo em breve
    { name: "Apólice Seguro Frota", category: "Seguro", dueDate: days(6) }, // vencendo em breve
    { name: "Alvará Sanitário", category: "Alvará", dueDate: days(90) }, // tranquilo
    { name: "Certificação ISO 9001", category: "Certificação", dueDate: days(180) },
    { name: "Licença de Operação Ambiental", category: "Licença", dueDate: days(-90) },
    { name: "Certidão Negativa Trabalhista", category: "Certidão", dueDate: days(1) },
    { name: "Contrato de Manutenção Elevadores", category: "Contrato", dueDate: days(45) },
    { name: "Seguro Predial", category: "Seguro", dueDate: days(-15) },
    { name: "Alvará de Publicidade", category: "Alvará", dueDate: days(10) },
    { name: "Certificação NR-12 Equipamentos", category: "Certificação", dueDate: days(365) },
    { name: "Licença de Funcionamento Filial", category: "Licença", dueDate: days(5) },
    { name: "Certidão Negativa Estadual", category: "Certidão", dueDate: days(-5) },
    { name: "Contrato de Software (licenciamento)", category: "Contrato", dueDate: days(200) },
    { name: "Seguro Responsabilidade Civil", category: "Seguro", dueDate: days(7) },
  ];
  state.items = state.items ?? [];
  for (const plan of itemsPlan) {
    if (state.items.some((it) => it.name === plan.name)) continue;
    try {
      const created = requireOk(
        await apiCall(page, "POST", "/items", { name: plan.name, category: plan.category, dueDate: plan.dueDate }, csrfToken, orgId),
        `criar item "${plan.name}"`,
      );
      state.items.push(created.item);
      log("Item criado", { name: plan.name, dueDate: plan.dueDate });
    } catch (err) {
      recordError(5, `criar item "${plan.name}"`, String(err));
    }
  }

  // Renew 2 items - real renewal history visible in ItemDetail.
  const toRenew = state.items.filter((it) => !it._renewed).slice(0, 2);
  for (const item of toRenew) {
    try {
      const newDue = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      const renewed = requireOk(
        await apiCall(page, "POST", `/items/${item.itemId}/renew`, { newDueDate: newDue }, csrfToken, orgId, { expectedVersion: item.version }),
        `renovar "${item.name}"`,
      );
      Object.assign(item, renewed.item, { _renewed: true });
      log("Item renovado", { name: item.name });
    } catch (err) {
      recordError(5, `renovar "${item.name}"`, String(err));
    }
  }

  // Custom reminder policy on 2 items (non-default trigger set).
  const toCustomize = state.items.filter((it) => !it._customPolicy).slice(2, 4);
  for (const item of toCustomize) {
    try {
      const input = {
        scope: "ITEM",
        itemId: item.itemId,
        rule: {
          name: `Política customizada — ${item.name}`,
          triggers: [
            { triggerId: randomUUID(), offsetIso: "-P14D", localTime: "09:00" },
            { triggerId: randomUUID(), offsetIso: "-P3D", localTime: "09:00" },
          ],
          timeZone: "America/Sao_Paulo",
          channels: ["EMAIL"],
        },
        enabled: true,
      };
      await requireOk(await apiCall(page, "POST", "/reminders/policies", input, csrfToken, orgId), `criar política de lembrete para "${item.name}"`);
      item._customPolicy = true;
      log("Política de lembrete customizada criada", { item: item.name });
    } catch (err) {
      recordError(5, `criar política de lembrete para "${item.name}"`, String(err));
    }
  }
  await context.close();
}

async function phase6(browser, state) {
  const { context, page, csrfToken } = await freshSession(browser, state);
  const orgId = state.organizationId;
  state.series = state.series ?? [];
  state.documentRequests = state.documentRequests ?? [];

  // Need requirements without an active series/pending avulso yet - reuse from phase 3.
  const availableReqs = (state.requirements ?? []).filter((r) => r.applicability === "APPLICABLE");
  const seriesPlan = [
    { cadenceDays: 30, recipientEmail: "contato+mensal@example.com", cancel: false },
    { cadenceDays: 90, recipientEmail: "contato+trimestral@example.com", cancel: false },
    { cadenceDays: 180, recipientEmail: "contato+semestral@example.com", cancel: true },
  ];
  for (const [i, plan] of seriesPlan.entries()) {
    const req = availableReqs[i];
    if (!req || state.series.some((s) => s.requirementId === req.requirementId)) continue;
    try {
      const created = requireOk(
        await apiCall(page, "POST", "/document-archive/series", { subjectId: req.subjectId, requirementId: req.requirementId, cadence: { intervalDays: plan.cadenceDays }, recipientEmail: plan.recipientEmail }, csrfToken, orgId),
        `criar série recorrente para "${req.name}"`,
      );
      let series = created.series;
      if (plan.cancel) {
        const cancelled = requireOk(await apiCall(page, "POST", `/document-archive/series/${req.subjectId}/${series.seriesId}/cancel`, { expectedVersion: series.version }, csrfToken, orgId), "cancelar série");
        series = cancelled.series;
      } else {
        // Materialize one real attempt so a DocumentRequest exists under this series too.
        try {
          const materialized = requireOk(
            await apiCall(page, "POST", `/document-archive/series/${req.subjectId}/${series.seriesId}/materialize`, { expectedVersion: series.version }, csrfToken, orgId),
            "materializar série",
          );
          series = materialized.series;
          state.documentRequests.push(materialized.request);
        } catch (err) {
          recordError(6, `materializar série de "${req.name}"`, String(err));
        }
      }
      state.series.push(series);
      log("Série recorrente criada", { requirement: req.name, cadenceDays: plan.cadenceDays, cancelled: plan.cancel });
    } catch (err) {
      recordError(6, `criar série para "${req.name}"`, String(err));
    }
  }

  // Avulso document requests on a few more requirements not used by series.
  const avulsoTargets = availableReqs.slice(seriesPlan.length, seriesPlan.length + 4);
  for (const req of avulsoTargets) {
    if (state.documentRequests.some((dr) => dr.requirementId === req.requirementId)) continue;
    try {
      const created = requireOk(
        await apiCall(
          page,
          "POST",
          `/document-archive/requirements/${req.subjectId}/${req.requirementId}/document-requests`,
          { deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), recipientEmail: "solicitado+avulso@example.com", idempotencyKey: randomUUID() },
          csrfToken,
          orgId,
        ),
        `criar solicitação avulsa para "${req.name}"`,
      );
      state.documentRequests.push(created.documentRequest);
      log("Solicitação avulsa criada", { requirement: req.name });
    } catch (err) {
      recordError(6, `criar solicitação avulsa para "${req.name}"`, String(err));
    }
  }
  await context.close();
}

async function phase7(browser, state) {
  // Create 2 more Cognito users, invite+accept as ADMIN and MEMBER, plus 1 pending (unaccepted)
  // VIEWER invitation - "papéis diferentes + convite pendente" from the brief.
  const { execFileSync } = await import("node:child_process");
  const { context, page, csrfToken } = await freshSession(browser, state);
  const orgId = state.organizationId;
  state.members = state.members ?? [];

  const membersPlan = [
    { suffix: "admin", role: "ADMIN", accept: true },
    { suffix: "member", role: "MEMBER", accept: true },
    { suffix: "viewer", role: "VIEWER", accept: false },
  ];

  for (const plan of membersPlan) {
    const email = `marcelo.mjgoncalves+omnivence-demo-2026-09-26-${plan.suffix}@gmail.com`;
    if (state.members.some((m) => m.email === email)) continue;
    try {
      const invited = requireOk(await apiCall(page, "POST", "/organizations/members/invite", { email, role: plan.role }, csrfToken, orgId), `convidar ${email}`);
      const record = { email, role: plan.role, invitationId: invited.invitation.invitationId, accepted: false };
      log("Convite enviado", { email, role: plan.role });

      if (plan.accept) {
        // Real Cognito user + real accept-invitation flow, same admin-create pattern as the
        // demo user itself. AcceptInvitation.tsx's route needs the invitation token, which
        // travels only in the invite e-mail in production - script reads it directly from
        // DynamoDB (read-only, same allowed table as reset-dev-data.ts) since no e-mail inbox
        // is reachable here.
        try {
          execFileSync("aws", ["cognito-idp", "admin-create-user", "--user-pool-id", "us-east-1_NZlvr5IIn", "--username", email, "--user-attributes", `Name=email,Value=${email}`, "Name=email_verified,Value=true", "--message-action", "SUPPRESS", "--profile", "claude-dev"], { stdio: "pipe" });
          execFileSync("aws", ["cognito-idp", "admin-set-user-password", "--user-pool-id", "us-east-1_NZlvr5IIn", "--username", email, "--password", "OmniDemo2026!Seed#Qw7", "--permanent", "--profile", "claude-dev"], { stdio: "pipe" });
          record.password = "OmniDemo2026!Seed#Qw7";
        } catch (err) {
          recordError(7, `criar usuário Cognito para ${email}`, String(err?.stderr ?? err));
        }
      }
      state.members.push(record);
    } catch (err) {
      recordError(7, `convidar ${email}`, String(err));
    }
  }
  await context.close();

  // Accepting invitations requires the real invitation token, which this script cannot read
  // (it's a bearer secret, never persisted in plaintext queryable form - `invitation-token.ts`'s
  // own selector/secret split, checked directly against the domain module before assuming
  // otherwise). Registering this honestly rather than faking acceptance.
  const toAccept = state.members.filter((m) => m.password && !m.accepted);
  if (toAccept.length > 0) {
    recordError(
      7,
      "aceitar convites como ADMIN/MEMBER",
      `${toAccept.length} usuário(s) Cognito criados e convidados, mas a aceitação real exige o token do convite (segredo com hash, nunca recuperável em texto puro do banco - confirmado contra invitation-token.ts) - ficam como convite PENDENTE (mesmo estado que a spec pede para o item VIEWER, só que também para estes 2). Papéis ADMIN/MEMBER reais não foram alcançados nesta rodada.`,
    );
  }
}

async function phase8(browser, state) {
  const { context, page, csrfToken } = await freshSession(browser, state);
  const orgId = state.organizationId;

  try {
    const current = requireOk(await apiCall(page, "GET", "/notifications/preferences", undefined, csrfToken, orgId), "buscar preferências de notificação");
    const input = {
      emailEnabled: true,
      locale: current.preferences.locale,
      quietHours: { enabled: true, startLocal: "20:00", endLocal: "07:00", timeZone: "America/Sao_Paulo" },
    };
    await requireOk(
      await (async () => {
        const res = await page.evaluate(
          async ({ input, csrfToken, origin, organizationId, expectedVersion }) => {
            const r = await fetch(origin + "/bff/api/notifications/preferences", {
              method: "PUT",
              headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "if-match": String(expectedVersion), "x-organization-id": organizationId },
              body: JSON.stringify(input),
              credentials: "include",
            });
            const text = await r.text();
            let json;
            try {
              json = JSON.parse(text);
            } catch {
              json = { raw: text };
            }
            return { status: r.status, json };
          },
          { input, csrfToken, origin: ORIGIN, organizationId: orgId, expectedVersion: current.preferences.version },
        );
        return res;
      })(),
      "atualizar preferências de notificação",
    );
    log("Preferências de notificação customizadas (quiet hours 20h-7h)");
  } catch (err) {
    recordError(8, "atualizar preferências de notificação", String(err));
  }

  try {
    await requireOk(
      await (async () => {
        const res = await page.evaluate(
          async ({ csrfToken, origin, organizationId }) => {
            const r = await fetch(origin + "/bff/api/document-archive/settings/document-request-delivery", {
              method: "PUT",
              headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "x-organization-id": organizationId },
              body: JSON.stringify({ initialInviteDeliveryDefault: "EMAIL" }),
              credentials: "include",
            });
            const text = await r.text();
            return { status: r.status, json: text ? JSON.parse(text) : {} };
          },
          { csrfToken, origin: ORIGIN, organizationId: orgId },
        );
        return res;
      })(),
      "configurar entrega de solicitação (A22)",
    );
    log("Entrega de solicitação (A22) configurada para EMAIL por padrão");
  } catch (err) {
    recordError(8, "configurar entrega de solicitação (A22)", String(err));
  }

  // A17 dossier export - preview then confirm, so at least 1 export run exists with real
  // history for the subject's dossier download screen (never polled to READY here - PDF/XLSX
  // generation is async and out of scope for this seed pass, registered honestly below).
  const dossierSubject = state.subjects?.find((s) => s.status !== "ARCHIVED");
  if (dossierSubject) {
    try {
      const preview = requireOk(await apiCall(page, "POST", `/document-archive/subjects/${dossierSubject.subjectId}/dossier`, undefined, csrfToken, orgId), "preview de dossiê");
      const confirmed = requireOk(
        await apiCall(page, "POST", `/document-archive/subjects/${dossierSubject.subjectId}/dossier/${preview.run.runId}/confirm`, { scopeHash: preview.run.scopeHash }, csrfToken, orgId),
        "confirmar geração de dossiê",
      );
      state.dossierRun = { subjectId: dossierSubject.subjectId, runId: confirmed.run.runId, status: confirmed.run.status };
      log("Exportação de dossiê iniciada (não aguardada até READY)", state.dossierRun);
      recordError(8, "aguardar dossiê ficar READY", "geração é assíncrona (fila real de PDF/XLSX) - run iniciado e confirmado, mas não aguardado até READY nesta rodada; a tela de download deve mostrar o run em GENERATING/CONFIRMED, não READY, até processar de verdade.");
    } catch (err) {
      recordError(8, `exportar dossiê de "${dossierSubject.displayName}"`, String(err));
    }
  }

  try {
    const input = {
      displayName: "Checklist Padrão — Fornecedor de Serviços",
      description: "Modelo aplicado a novos fornecedores de serviços continuados.",
      items: [
        { name: "Certidão Negativa de Débitos Federais", applicability: "APPLICABLE" },
        { name: "Contrato Social Atualizado", applicability: "APPLICABLE" },
        { name: "Comprovante de Endereço", applicability: "APPLICABLE" },
      ],
    };
    await requireOk(await apiCall(page, "POST", "/document-archive/requirement-templates", input, csrfToken, orgId), "criar template de requisitos");
    log("Template de requisitos criado");
  } catch (err) {
    recordError(8, "criar template de requisitos", String(err));
  }

  await context.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
