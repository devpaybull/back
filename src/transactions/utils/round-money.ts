export function roundMoney(value: number): number {
  const factor = 1000;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;

  let rounded: number;
  if (Math.abs(fraction - 0.5) < 1e-9) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else {
    rounded = Math.round(scaled);
  }

  const result = rounded / factor;
  return result === 0 ? 0 : result;
}
