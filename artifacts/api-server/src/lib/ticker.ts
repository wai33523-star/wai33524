export function normalizeTickerInput(input: unknown): string {
  const cleanInput = String(input ?? "").trim().toUpperCase();

  if (["HSI", "^HSI", "恆指", "恒指"].includes(cleanInput)) {
    return "^HSI";
  }

  if (/^\d+$/.test(cleanInput)) {
    return `${cleanInput.padStart(4, "0")}.HK`;
  }

  return cleanInput;
}