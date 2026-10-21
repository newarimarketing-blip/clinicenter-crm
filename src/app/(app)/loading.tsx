// Aparece na hora ao trocar de seção, enquanto a página busca os dados.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-7 w-40 rounded-lg bg-black/10" />
        <div className="h-4 w-80 max-w-full rounded bg-black/5" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card h-24" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card h-64" />
        <div className="card h-64" />
      </div>
    </div>
  );
}
