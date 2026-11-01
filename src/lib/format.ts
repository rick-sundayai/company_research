const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A calendar date (YYYY-MM-DD) as "Nov 3, 2026". */
export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

/** The calendar day (UTC) of a timestamp, as "Nov 3, 2026". */
export function formatDay(timestamp: string): string {
  return dateFormat.format(new Date(timestamp));
}

const priceFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** A share price in dollars, as "$23.40". */
export function formatPrice(price: number): string {
  return priceFormat.format(price);
}
