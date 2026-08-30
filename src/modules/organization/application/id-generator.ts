/** ID generation port — mesmo padrão de SubjectIdGenerator/ExpirationIdGenerator. Prefixos
 * distintos (`org_`/`membership_` vs `user_`) garantem estruturalmente que `organizationId`
 * nunca colide com `userId` — não por acidente de aleatoriedade do ULID, mas por construção
 * do prefixo (physical model §15: "provar sistematicamente userId != tenantId"). */
export interface OrganizationIdGenerator {
  newOrganizationId(): string;
  newMembershipId(): string;
}
