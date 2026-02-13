// @ts-ignore
export const calculatePrice = (sold: number, tokensToBy: number): bigint => {
  // Constants from lib.rs
  const DECIMALS = 10n ** 18n;
  const DIV_REP = 140n;
  const LAMPORTS_PER_SOL = 10n ** 9n;

  const a_numerator = 1n * DECIMALS;
  const a_denominator = 10n ** 13n;
  const c_numerator = 4n * DECIMALS;
  const c_denominator = 10n ** 5n;

  // Calculate factors
  const factor1 =
    (BigInt(sold) * a_numerator) / a_denominator * BigInt(tokensToBy);

  const factor2 =
    ((BigInt(tokensToBy) * BigInt(tokensToBy)) / 2n) *
    a_numerator /
    a_denominator;

  const factor3 =
    (BigInt(tokensToBy) * c_numerator) / c_denominator;

  const value = factor1 + factor2 + factor3;

  // Convert to lamports
  const value_final =
    (value *LAMPORTS_PER_SOL) / (DIV_REP * DECIMALS);

  return value_final;
}

// Calculates lamports for a single buy, carrying an incoming dust remainder,
// and returns the charged lamports and the updated dust.
// This matches the on-chain logic with remainder carry.
// @ts-ignore
export const calculatePriceWithDust = (
  sold: number,
  tokensToBy: number,
  incomingDust: bigint
): { lamports: bigint; newDust: bigint } => {
  const DECIMALS = 10n ** 18n;
  const DIV_REP = 140n;
  const LAMPORTS_PER_SOL = 10n ** 9n;

  const a_numerator = 1n * DECIMALS;
  const a_denominator = 10n ** 13n;
  const c_numerator = 4n * DECIMALS;
  const c_denominator = 10n ** 5n;

  const factor1 =
    (BigInt(sold) * a_numerator) / a_denominator * BigInt(tokensToBy);

  const factor2 =
    ((BigInt(tokensToBy) * BigInt(tokensToBy)) / 2n) *
    a_numerator /
    a_denominator;

  const factor3 =
    (BigInt(tokensToBy) * c_numerator) / c_denominator;

  const value = factor1 + factor2 + factor3;
  const divisor = DIV_REP * DECIMALS;
  const scaled = value * LAMPORTS_PER_SOL + incomingDust;
  const lamports = scaled / divisor;
  const newDust = scaled % divisor;
  return { lamports, newDust };
}

// Calculates the total lamports for a sequence of buys starting at `soldStart`,
// carrying dust between steps to match on-chain totals.
// @ts-ignore
export const calculatePriceSequential = (soldStart: number, plan: number[]): bigint => {
  let total = 0n;
  let dust = 0n;
  let sold = soldStart;
  for (const t of plan) {
    const { lamports, newDust } = calculatePriceWithDust(sold, t, dust);
    total += lamports;
    dust = newDust;
    sold += t;
  }
  return total;
}

// @ts-ignore
export const solanaToTokens = (lamports: bigint, sold: number): number => {
  // Constants from lib.rs
  const DECIMALS = 10n ** 18n;
  const DIV_REP = 140n;
  const LAMPORTS_PER_SOL = 10n ** 9n;

  const a_numerator = 1n * DECIMALS;
  const a_denominator = 10n ** 13n;
  const c_numerator = 4n * DECIMALS;
  const c_denominator = 10n ** 5n;

  // Reverse the calculatePrice formula to find tokensToBy
  // value_final = (value * LAMPORTS_PER_SOL) / (DIV_REP * DECIMALS)
  // value = value_final * (DIV_REP * DECIMALS) / LAMPORTS_PER_SOL
  const value = (BigInt(lamports) * DIV_REP * DECIMALS) / LAMPORTS_PER_SOL;

  // value = factor1 + factor2 + factor3
  // value = sold * a_num/a_denom * tokensToBy + (tokensToBy^2 / 2) * a_num/a_denom + tokensToBy * c_num/c_denom
  // This is a quadratic equation: (a_num/(2*a_denom)) * t^2 + (sold*a_num/a_denom + c_num/c_denom) * t - value = 0
  
  const coeff_a = a_numerator / (2n * a_denominator); // quadratic coefficient
  const coeff_b = (BigInt(sold) * a_numerator) / a_denominator + c_numerator / c_denominator; // linear coefficient
  const coeff_c = -value; // constant term

  // Quadratic formula: t = (-b + sqrt(b^2 - 4ac)) / 2a
  const discriminant = coeff_b * coeff_b - 4n * coeff_a * coeff_c;
  
  if (discriminant < 0n) {
    throw new Error("Cannot buy tokens: discriminant is negative");
  }

  // Integer square root for BigInt
  const sqrt_discriminant = sqrtBigInt(discriminant);
  
  // We want the positive root
  const tokensToBy = (-coeff_b + sqrt_discriminant) / (2n * coeff_a);

  return Number(tokensToBy);
}

// Helper function to compute integer square root of BigInt
function sqrtBigInt(n: bigint): bigint {
  if (n < 0n) throw new Error("Square root of negative number");
  if (n === 0n) return 0n;
  
  let x = n;
  let y = (x + 1n) / 2n;
  
  while (y < x) {
    x = y;
    y = (x + (n / x)) / 2n;
  }
  
  return x;
}