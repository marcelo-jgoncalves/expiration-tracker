/**
 * D-339 achado 4 (redesenho do fluxo de detalhe de Fornecedor, item 35) — contrato comportamental
 * compartilhado de "Nova solicitação avulsa", extraído para nunca mais divergir entre as 2
 * entradas reais (`SubjectRequests.tsx`'s `CreateAvulsoDialog` e `RequirementDetail.tsx`'s
 * `NewRequestForm`). Antes desta extração, `RequirementDetail` exigia e-mail incondicionalmente e
 * nunca enviava `initialInviteDelivery` (prometia envio que o modo efetivo `MANUAL` não
 * sustentava) - `SubjectRequests` já fazia a coisa certa. ADR-0016 Decision B é a fonte da
 * decisão de produto (3 modos); este módulo só garante que as 2 telas implementem essa decisão
 * de forma idêntica, por construção.
 */
import { useState, type FormEvent } from "react";
import { useCreateDocumentRequest } from "../../hooks/useCreateDocumentRequest.js";
import { RadioGroup } from "../../components/ui/RadioGroup.js";
import { TextField } from "../../components/forms/TextField.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { ApiError } from "../../api/errors.js";
import type { InitialInviteDeliveryOverride } from "../../api/types.js";

export const DELIVERY_OVERRIDE_OPTIONS: { value: InitialInviteDeliveryOverride; label: string; hint: string }[] = [
  { value: "DEFAULT", label: "Usar padrão da organização", hint: "Segue a configuração em Configurações > Entrega de solicitação." },
  { value: "MANUAL", label: "Entrega manual", hint: "Nenhum e-mail automático é enviado para esta solicitação." },
  { value: "EMAIL", label: "E-mail automático", hint: "O link é enviado por e-mail no momento da criação, exige um destinatário." },
];

/** `requirementId` is a plain string here (never optional) - both real entry points always know
 * it before rendering this form (SubjectRequests' Combobox already resolved to a real Requirement
 * before showing the rest of the form; RequirementDetail always has it fixed from props) - never
 * checked again here, so this hook stays a single, unbranched contract for both. */
export function useCreateDocumentRequestForm(subjectId: string, requirementId: string, onDone: () => void) {
  const mutation = useCreateDocumentRequest(subjectId);
  const [email, setEmail] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<InitialInviteDeliveryOverride>("DEFAULT");
  const [errors, setErrors] = useState<string[]>([]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Client-side mirror of the backend's own rule (EMAIL, explicit or resolved via DEFAULT,
    // requires a recipientEmail) - only enforceable here for the EXPLICIT case, since DEFAULT's
    // real resolution depends on the org's A22 preference, which this form does not read.
    if (deliveryMode === "EMAIL" && !email.trim()) {
      setErrors(["Informe o e-mail do destinatário para entrega por e-mail automático."]);
      return false;
    }
    setErrors([]);
    try {
      await mutation.mutateAsync({
        subjectId,
        requirementId,
        ...(email.trim() ? { recipientEmail: email.trim() } : {}),
        initialInviteDelivery: deliveryMode,
      });
      onDone();
      return true;
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : "Não foi possível criar a solicitação."]);
      return false;
    }
  }

  return { email, setEmail, deliveryMode, setDeliveryMode, errors, setErrors, submit, mutation };
}

export function DeliveryModeFields({
  idPrefix,
  email,
  onEmailChange,
  deliveryMode,
  onDeliveryModeChange,
}: {
  idPrefix: string;
  email: string;
  onEmailChange: (v: string) => void;
  deliveryMode: InitialInviteDeliveryOverride;
  onDeliveryModeChange: (v: InitialInviteDeliveryOverride) => void;
}) {
  return (
    <>
      <TextField
        id={`${idPrefix}-email`}
        label="Destinatário"
        type="text"
        value={email}
        onChange={onEmailChange}
        required={deliveryMode === "EMAIL"}
        hint="E-mail que receberá o link de convidado, se a entrega for por e-mail."
      />
      <RadioGroup
        legend="Entrega do convite inicial"
        variant="cards"
        options={DELIVERY_OVERRIDE_OPTIONS}
        value={deliveryMode}
        onChange={(value) => onDeliveryModeChange(value as InitialInviteDeliveryOverride)}
        required
      />
      {/* ADR-0016 Decision B: never promises unconditional e-mail - the effective mode follows
          the organization's A22 configuration unless explicitly overridden above. */}
      <InlineNotice tone="neutral">
        O link de convidado sem login é sempre gerado. O envio automático por e-mail (quando aplicável) é confirmado apenas como aceito pelo provedor — não como recebido.
      </InlineNotice>
    </>
  );
}
