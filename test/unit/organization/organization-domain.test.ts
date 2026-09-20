import { describe, expect, it } from "vitest";
import { REMINDER_LOCAL_TIME_CANDIDATES, isValidLocalTime, pickDefaultReminderLocalTime } from "../../../src/modules/organization/domain/organization.js";

// G-V3 (test-engineering-standard.md): cada `it()` abaixo tem, em comentário, pelo menos uma
// mutação concreta que faria a asserção falhar.
describe("REMINDER_LOCAL_TIME_CANDIDATES", () => {
  // Mutação: mudar o passo de 30 para 15 minutos (ou o range 10-17) geraria uma quantidade
  // diferente de 15 ou um valor fora do conjunto esperado.
  it("is exactly the 15 on-the-hour/half-hour values from 10:00 to 17:00, never a broken minute", () => {
    expect(REMINDER_LOCAL_TIME_CANDIDATES).toEqual([
      "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30",
      "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00",
    ]);
  });
});

describe("pickDefaultReminderLocalTime", () => {
  // Mutação: usar `random() * (length + 1)` (off-by-one) faria random()=~0.999 apontar para um
  // índice fora do array (undefined) em vez de sempre cair dentro de REMINDER_LOCAL_TIME_CANDIDATES.
  it("maps random()=0 to the first candidate and random() just under 1 to the last, never undefined", () => {
    expect(pickDefaultReminderLocalTime(() => 0)).toBe("10:00");
    expect(pickDefaultReminderLocalTime(() => 0.9999999)).toBe("17:00");
  });

  // Mutação: esquecer de injetar `random` e sempre usar `Math.random()` de verdade faria este
  // teste (que pede um valor do meio do intervalo) ser não-determinístico em vez de estável.
  it("is deterministic for a fixed injected random source", () => {
    const midpoint = () => 0.5;
    expect(pickDefaultReminderLocalTime(midpoint)).toBe(pickDefaultReminderLocalTime(midpoint));
  });
});

describe("isValidLocalTime", () => {
  // Mutação: um regex frouxo (ex. `\d{1,2}:\d{1,2}`) aceitaria "9:00" ou "24:00" - a asserção
  // abaixo cobre exatamente esses dois casos de formato relaxado demais.
  it("accepts zero-padded HH:mm within valid ranges and rejects malformed/out-of-range input", () => {
    expect(isValidLocalTime("00:00")).toBe(true);
    expect(isValidLocalTime("23:59")).toBe(true);
    expect(isValidLocalTime("09:00")).toBe(true);
    expect(isValidLocalTime("9:00")).toBe(false);
    expect(isValidLocalTime("24:00")).toBe(false);
    expect(isValidLocalTime("10:60")).toBe(false);
    expect(isValidLocalTime("10:00:00")).toBe(false);
    expect(isValidLocalTime("")).toBe(false);
  });
});
