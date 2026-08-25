/**
 * Deliberate stand-in for a route this foundation stage does not implement (mission §77:
 * "Não implementar todas as surfaces nesta fase" - only Vencimentos/Overview gets a real
 * page). Never claims functionality that isn't there (mission §73) - plain, honest copy,
 * no visual polish (mission §82).
 */
export function NotImplementedPlaceholder({ title }: { title: string }) {
  return (
    <div>
      <h1>{title}</h1>
      <p>Esta tela ainda não foi implementada no frontend de produção nesta etapa.</p>
    </div>
  );
}
