/** Verschiebt einen Zeitpunkt auf das nächste Vielfache von `minutes` (auf- bzw. abwärts). */
export function stepTime(date: Date, direction: 1 | -1, minutes: number): Date {
  const unit = minutes * 60_000;
  const t = date.getTime();
  return new Date(
    direction > 0 ? Math.floor(t / unit) * unit + unit : Math.ceil(t / unit) * unit - unit,
  );
}
