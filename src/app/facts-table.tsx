import { formatFact, type FactKey, type KeyFact } from "@/lib/key-facts";

type Fact = { key: FactKey; label: string; unit: KeyFact["unit"]; value: number | null; sectorMedian: number | null };

/** Each key fact beside its Sector Median, with "not found" for a gap. */
export function FactsTable({ facts, companyName }: { facts: Fact[]; companyName: string }) {
  return (
    <div className="table-scroll">
    <table>
      <caption>Key facts</caption>
      <thead>
        <tr>
          <th scope="col">Fact</th>
          <th scope="col">{companyName}</th>
          <th scope="col">Sector Median</th>
        </tr>
      </thead>
      <tbody>
        {facts.map((f) => (
          <tr key={f.key}>
            <th scope="row">{f.label}</th>
            <td className={f.value === null ? "not-found" : undefined}>{formatFact(f.value, f.unit)}</td>
            <td className={f.sectorMedian === null ? "not-found" : undefined}>{formatFact(f.sectorMedian, f.unit)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
