import type { DigestTrigger } from "./digest";
import { formatDate, formatPrice } from "./format";

const percent = (share: number) => `${Math.round(Math.abs(share) * 1000) / 10}%`;
const number = (value: unknown) => (typeof value === "number" ? value : null);

/** What a Trigger found, in words, e.g. "up 12% in a day ($70.00 to $78.40)". */
export function triggerText({ kind, detail }: DigestTrigger): string {
  switch (kind) {
    case "earnings_reported": {
      const actual = number(detail.epsActual);
      const estimate = number(detail.epsEstimate);
      const date = typeof detail.date === "string" ? formatDate(detail.date) : "recently";
      return `Reported ${date}: EPS ${actual ?? "not found"}${estimate === null ? "" : ` against ${estimate} expected`}`;
    }
    case "price_move": {
      const change = number(detail.change) ?? 0;
      const from = number(detail.from);
      const to = number(detail.to);
      const prices = from !== null && to !== null ? ` (${formatPrice(from)} to ${formatPrice(to)})` : "";
      const since = typeof detail.since === "string" ? ` since the Brief of ${formatDate(detail.since)}` : " in a day";
      return `${change >= 0 ? "up" : "down"} ${percent(change)}${since}${prices}`;
    }
    case "analyst_shift":
      return `buy share ${percent(number(detail.from) ?? 0)} to ${percent(number(detail.to) ?? 0)} (${number(detail.analysts) ?? "?"} analysts)`;
    case "routine":
      return typeof detail.lastBrief === "string" ? `latest Brief ${formatDate(detail.lastBrief)}` : "";
    default:
      return "";
  }
}
