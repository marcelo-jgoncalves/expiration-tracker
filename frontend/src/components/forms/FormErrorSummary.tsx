/**
 * Whole-form error summary (mission §34): errors that aren't attributable to one known field
 * (a nested validation path, a network/unknown-outcome/backend failure) still need to be
 * seen and announced - never silently dropped just because they don't map to a `TextField`.
 */
export function FormErrorSummary({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert">
      {errors.length === 1 ? (
        <p>{errors[0]}</p>
      ) : (
        <>
          <p>Corrija os seguintes problemas:</p>
          <ul>
            {errors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
