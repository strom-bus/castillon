/**
 * Marcador de posición de la Fase 0.
 * En la Fase 1 este componente se sustituye por el canvas (React Flow) + transporte.
 * Ver PLAN.md §6.
 */
export default function App() {
  return (
    <main
      style={{
        display: 'grid',
        placeContent: 'center',
        gap: '0.75rem',
        height: '100%',
        textAlign: 'center',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '2.5rem', letterSpacing: '-0.02em' }}>Castillón</h1>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        Sintetizador modular por nodos con ejecución en cascada
      </p>
      <p style={{ margin: 0, color: 'var(--accent)', fontSize: '0.875rem' }}>
        Fase 0 · andamiaje desplegado
      </p>
    </main>
  )
}
