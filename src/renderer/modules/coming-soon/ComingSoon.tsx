/**
 * Placeholder shown in modules that aren't part of the MVP yet.
 */

export function ComingSoon({ name, detail }: { name: string; detail: string }): JSX.Element {
  return (
    <div className="ga98-coming-soon">
      <h2 style={{ margin: 0 }}>{name}</h2>
      <p style={{ margin: 0 }}>{detail}</p>
      <p style={{ margin: 0, fontSize: 11, color: '#444' }}>This module ships in v1.0.0.</p>
    </div>
  );
}
