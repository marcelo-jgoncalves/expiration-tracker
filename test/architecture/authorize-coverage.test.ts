/**
 * Architecture test — E-016 (full-audit round2, Governança de Produto/Multi-tenant, achado
 * decisão-independente ainda pendente: "sem enforcement automático de que toda rota nova chama
 * authorize()"). D-286-era finding: nenhum vazamento cross-tenant real foi encontrado por
 * nenhuma rodada de auditoria deste projeto, mas a garantia até agora era só disciplina/revisão
 * manual — um handler HTTP novo que esquecesse de chamar `authorize()` (ou de delegar a uma
 * camada de aplicação que chama) não seria pego por nenhum gate automatizado.
 *
 * Mecanismo: para cada arquivo `src/modules/<module>/http/*.ts` que exporta pelo menos uma
 * função `handle*`, exige que OU o próprio arquivo chame `authorize(` diretamente, OU o
 * diretório-irmão `src/modules/<module>/application/` contenha pelo menos um arquivo que chame
 * `authorize(` (o padrão real predominante neste projeto - o handler HTTP delega para um
 * serviço de aplicação, que chama `authorize()` internamente, ex.
 * `WhatsAppOptInService.recordOptIn()`/`NotificationPreferencesService`). Verificado por leitura
 * estática real do arquivo (grep sobre o texto), não por execução - mesma classe de prova que
 * `system-mutation-allowlist.test.ts`/`tenant-fence-boundary.test.ts` já usam para outras
 * invariantes deste projeto.
 *
 * `PUBLIC_ROUTE_ALLOWLIST` é a exceção deliberada e nomeada individualmente: rotas
 * genuinamente públicas/anônimas (guest/external-share, `authorization_type = NONE` no API
 * Gateway) que NUNCA chamam `authorize()` por design — a defesa delas é o próprio
 * `GuestAccessInvalidError` de colapso anti-enumeração, não RBAC. Cada entrada exige uma razão
 * citada; um arquivo de handler novo fora desta lista e sem nenhum `authorize(` alcançável
 * (nele mesmo ou no `application/` do módulo) falha este teste - fechando o gap real nomeado em
 * E-016, não apenas documentando-o.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");
const MODULES_DIR = join(REPO_ROOT, "src", "modules");

/** Cada entrada precisa de uma razão nomeada - nunca um caminho solto. Mantida
 * independentemente do código (mesmo espírito de `ApprovedSystemMutationKind` em
 * `system-mutation-allowlist.test.ts`): se um destes arquivos ganhar uma rota NOVA que devia
 * ser autenticada, o teste abaixo não pega isso automaticamente (é uma allowlist de ARQUIVO,
 * não de rota individual) - mas qualquer arquivo de handler HTTP genuinamente NOVO fora desta
 * lista precisa fechar o gap por si mesmo, o que é o achado real que este teste fecha. */
const PUBLIC_ROUTE_ALLOWLIST: Record<string, string> = {
  "document-archive/http/document-archive-guest-handlers.ts":
    "D-146 - rotas de guest (authorization_type NONE no API Gateway), defendidas por GuestAccessInvalidError/anti-enumeração, nunca por authorize()/RBAC.",
  "document-archive/http/external-share-handlers.ts":
    "D-225/D-273 - resolução anônima de ExternalShareLink (authorization_type NONE), mesma postura de isolamento do handler guest acima.",
  "subject/http/guest-handlers.ts":
    "D-145 - GuestSubmissionService.resolveToken() é a única defesa, nunca RequestContextResolver/authorize() (mesma classe das duas rotas acima).",
  "identity/http/test-route-handler.ts":
    "Rota /test/ping (M1 exit-criterion) - endpoint de smoke test sem recurso de negócio para autorizar; já JWT-protegida no API Gateway, mas o handler em si não tem ação RBAC própria.",
  "bff/http/http-types.ts": "Arquivo só de tipos (HttpRequest/HttpResponse) - nunca exporta uma função handle*, não é um handler real.",
};

/** Um arquivo "é um handler HTTP real" quando exporta pelo menos uma função cujo nome começa
 * com `handle` - mesma convenção que todo handler deste projeto já segue
 * (`handleGetPreferences`/`handleUpdatePreferences`/`handleRecordWhatsAppOptIn`/etc, visível no
 * próprio grep desta suite). Um arquivo de tipos puro (`http-types.ts`) nunca bate neste
 * padrão. */
function exportsAtLeastOneHandler(source: string): boolean {
  return /export\s+(async\s+)?function\s+handle[A-Z]\w*/.test(source);
}

function callsAuthorize(source: string): boolean {
  return /authorize\(/.test(source);
}

interface HttpHandlerFile {
  /** POSIX-style, forward-slash relative path (e.g. "subject/http/guest-handlers.ts") -
   * deliberately normalized so this test's allowlist keys and output are stable across
   * Windows/POSIX, never `path.join`'s platform-dependent separator. */
  relativePath: string;
  moduleName: string;
}

function listHttpHandlerFiles(): HttpHandlerFile[] {
  const results: HttpHandlerFile[] = [];
  for (const moduleName of readdirSync(MODULES_DIR)) {
    const httpDir = join(MODULES_DIR, moduleName, "http");
    let entries: string[];
    try {
      entries = readdirSync(httpDir);
    } catch {
      continue; // module has no http/ dir at all (e.g. a purely async-worker module).
    }
    for (const entry of entries) {
      if (!entry.endsWith(".ts")) continue;
      results.push({ relativePath: `${moduleName}/http/${entry}`, moduleName });
    }
  }
  return results;
}

function applicationDirCallsAuthorize(moduleName: string): boolean {
  const appDir = join(MODULES_DIR, moduleName, "application");
  let entries: string[];
  try {
    entries = readdirSync(appDir);
  } catch {
    return false; // module has no application/ dir - the handler file itself must call authorize().
  }
  return entries
    .filter((e) => e.endsWith(".ts"))
    .some((e) => callsAuthorize(readFileSync(join(appDir, e), "utf8")));
}

describe("architecture: every HTTP handler module reaches authorize() (E-016, D-286)", () => {
  const files = listHttpHandlerFiles();

  it("sanity: at least one HTTP handler file was found under src/modules/*/http/ (catches a broken glob silently passing vacuously)", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it("PUBLIC_ROUTE_ALLOWLIST entries still exist on disk (catches a stale allowlist entry for a file that was renamed/deleted)", () => {
    const knownPaths = new Set(files.map((f) => f.relativePath));
    for (const relativePath of Object.keys(PUBLIC_ROUTE_ALLOWLIST)) {
      expect(knownPaths, `allowlisted path "${relativePath}" no longer exists under src/modules/*/http/`).toContain(relativePath);
    }
  });

  for (const { relativePath, moduleName } of files) {
    const allowReason = PUBLIC_ROUTE_ALLOWLIST[relativePath];
    const absolutePath = join(MODULES_DIR, ...relativePath.split("/"));
    const source = readFileSync(absolutePath, "utf8");

    if (allowReason) {
      it(`${relativePath}: allowlisted as a genuinely public route (${allowReason})`, () => {
        expect(true).toBe(true);
      });
      continue;
    }

    if (!exportsAtLeastOneHandler(source)) {
      it(`${relativePath}: no exported handle*() function, not a real HTTP handler - skipped`, () => {
        expect(true).toBe(true);
      });
      continue;
    }

    it(`${relativePath}: calls authorize() itself, or its module's application/ layer does`, () => {
      const ok = callsAuthorize(source) || applicationDirCallsAuthorize(moduleName);
      expect(
        ok,
        `${relativePath} exports a handle*() function but neither it nor any file under src/modules/${moduleName}/application/ calls authorize() - ` +
          `either this is a real gap (add the RBAC check) or a genuinely public route that belongs in PUBLIC_ROUTE_ALLOWLIST above with a named reason.`,
      ).toBe(true);
    });
  }
});
