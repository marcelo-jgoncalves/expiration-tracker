/**
 * AcceptInvitationService — Wave B2B-8 (D-099). Implementação literal de
 * `multi-user-b2b-physical-model.md` §9 (D-086), com o achado real da Rodada 2/3 do debate de
 * escopo: o consumo do `InvitationTokenPointer` (`consumedAt`) acontece DENTRO da transação
 * atômica, não só verificado numa leitura prévia — fecha anti-replay (§121 Q14) de verdade.
 *
 * Autorização por IDENTIDADE, não por tenant (mesmo padrão de `POST /bff/organizations`, D-096)
 * — o chamador ainda não tem `Membership` nesta organização (pode não ter nenhuma em lugar
 * algum), então não há `RequestContext`/`authorize()` tenant-scoped para passar por aqui. A
 * proteção real é o token (posse do link) + `emailNormalized = :callerVerifiedEmail` estrutural
 * (fecha account-takeover, §121 Q13).
 *
 * Fluxo em 2 fases: (1) resolução do token FORA da transação (parse/lookup/timing-safe match/
 * expiração/consumo-ainda-não-marcado) — qualquer falha aqui é anti-enumeration, erro genérico;
 * (2) transação atômica de 6 itens (5 + o incremento condicional de `ownerCount` só quando
 * `role === "OWNER"`).
 */
import { isTransactionCanceled, getCancellationReasonCodes, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { ConflictError, InvitationTokenUnavailableError } from "../../../shared/errors/app-error.js";
import { invitationDedupKey, invitationKey, type Invitation } from "../domain/invitation.js";
import {
  hmacInvitationTokenCrypto,
  invitationSecretMatches,
  invitationTokenPointerKey,
  parseInvitationToken,
  type InvitationTokenPointer,
} from "../domain/invitation-token.js";
import { appendMembershipAuditToTransaction, buildMembershipAuditEvent } from "../domain/audit-event.js";
import { membershipGsi4Keys, membershipKey, type Membership } from "../domain/membership.js";
import { organizationKey } from "../domain/organization.js";
import type { OrganizationStore } from "../ports/organization-store.js";
import type { OrganizationIdGenerator } from "./id-generator.js";

export interface AcceptInvitationInput {
  token: string;
  userId: string;
  /** E-mail já verificado do chamador (pré-requisito de login) — literal já resolvido, nunca
   * lido de novo dentro deste serviço. */
  callerVerifiedEmail: string;
}

export interface AcceptInvitationResult {
  organizationId: string;
  membershipId: string;
  role: Membership["role"];
}

export class AcceptInvitationService {
  constructor(
    private readonly store: OrganizationStore,
    private readonly tableName: string,
    private readonly ids: OrganizationIdGenerator,
    private readonly tokenPepper: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async accept(input: AcceptInvitationInput): Promise<AcceptInvitationResult> {
    const parsed = parseInvitationToken(input.token);
    if (!parsed) throw new InvitationTokenUnavailableError();

    const selectorHash = hmacInvitationTokenCrypto.hash(this.tokenPepper, parsed.selector);
    const pointer = await this.store.get<InvitationTokenPointer>(invitationTokenPointerKey(selectorHash));
    if (!pointer || !invitationSecretMatches(this.tokenPepper, parsed.secret, pointer.secretHash)) {
      throw new InvitationTokenUnavailableError();
    }
    const nowIso = this.now();
    if (pointer.consumedAt !== undefined || pointer.expiresAt <= nowIso) {
      throw new InvitationTokenUnavailableError();
    }

    const invitation = await this.store.get<Invitation>(invitationKey(pointer.organizationId, pointer.invitationId));
    if (!invitation || invitation.status !== "PENDING") {
      throw new InvitationTokenUnavailableError();
    }

    const emailNormalized = input.callerVerifiedEmail.trim().toLowerCase();
    const newMembershipId = this.ids.newMembershipId();
    const gsi4Keys = membershipGsi4Keys(input.userId, invitation.organizationId, newMembershipId);

    const membershipEntry: TransactWriteEntry = {
      Update: {
        TableName: this.tableName,
        Key: membershipKey(invitation.organizationId, input.userId),
        UpdateExpression:
          "SET role = :role, #status = :active, membershipId = :membershipId, joinedAt = :now, GSI4PK = :gsi4pk, GSI4SK = :gsi4sk, version = if_not_exists(version, :one), createdAt = if_not_exists(createdAt, :now)",
        ConditionExpression: "attribute_not_exists(PK) OR #status = :removed",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":role": invitation.role,
          ":active": "ACTIVE",
          ":membershipId": newMembershipId,
          ":now": nowIso,
          ":gsi4pk": gsi4Keys.GSI4PK,
          ":gsi4sk": gsi4Keys.GSI4SK,
          ":one": 1,
          ":removed": "REMOVED",
        },
      },
    };

    const invitationEntry: TransactWriteEntry = {
      Update: {
        TableName: this.tableName,
        Key: invitationKey(invitation.organizationId, invitation.invitationId),
        UpdateExpression: "SET #status = :accepted, acceptedAt = :now",
        ConditionExpression: "#status = :pending AND emailNormalized = :callerVerifiedEmail",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":accepted": "ACCEPTED", ":pending": "PENDING", ":callerVerifiedEmail": emailNormalized, ":now": nowIso },
      },
    };

    const tokenEntry: TransactWriteEntry = {
      Update: {
        TableName: this.tableName,
        Key: invitationTokenPointerKey(pointer.selectorHash),
        UpdateExpression: "SET consumedAt = :now",
        ConditionExpression: "attribute_not_exists(consumedAt) AND expiresAt > :now",
        ExpressionAttributeNames: {},
        ExpressionAttributeValues: { ":now": nowIso },
      },
    };

    const dedupEntry: TransactWriteEntry = {
      Delete: { TableName: this.tableName, Key: invitationDedupKey(invitation.organizationId, invitation.emailNormalized) },
    };

    const entries: TransactWriteEntry[] = [membershipEntry, invitationEntry, tokenEntry, dedupEntry];
    appendMembershipAuditToTransaction(
      entries,
      this.tableName,
      buildMembershipAuditEvent({
        auditEventId: this.ids.newAuditEventId(),
        organizationId: invitation.organizationId,
        resourceType: "Membership",
        resourceId: newMembershipId,
        action: "INVITATION_ACCEPTED",
        actor: { type: "USER", userId: input.userId },
        newVersion: 1,
        changes: { role: invitation.role, invitationId: invitation.invitationId },
        occurredAt: nowIso,
        correlationId: `accept-invitation-${invitation.invitationId}`,
      }),
    );

    // Incrementa ownerCount só quando o convite promove diretamente a OWNER - reaproveita o
    // caminho de incremento que o physical model §8 já previa para "promover um segundo membro
    // a OWNER", nunca exercitado até B2B-8 (nenhum writer real produzia isso antes).
    if (invitation.role === "OWNER") {
      entries.push({
        Update: {
          TableName: this.tableName,
          Key: organizationKey(invitation.organizationId),
          UpdateExpression: "SET ownerCount = ownerCount + :one",
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeNames: {},
          ExpressionAttributeValues: { ":one": 1 },
        },
      });
    }

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const reasons = getCancellationReasonCodes(err);
        if (reasons?.[0] === "ConditionalCheckFailed") {
          throw new ConflictError("You are already a member of this organization.", { organizationId: invitation.organizationId });
        }
        throw new InvitationTokenUnavailableError();
      }
      throw err;
    }

    return { organizationId: invitation.organizationId, membershipId: newMembershipId, role: invitation.role };
  }
}
