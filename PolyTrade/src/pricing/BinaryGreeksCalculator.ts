/**
 * Binary Greeks Calculator
 *
 * Calculates Greeks (delta, gamma, vega, theta) for binary (cash-or-nothing) options.
 * These are digital options that pay $1 if the underlying is above (call) or below (put)
 * the strike price at expiration.
 *
 * Used for pricing Polymarket crypto prediction markets like:
 * "Will BTC be above $100,000 on January 28?"
 */

export interface BinaryGreeks {
  delta: number;      // dPrice/dSpot - sensitivity to spot price movement
  gamma: number;      // d(delta)/dSpot - rate of delta change (convexity)
  vega: number;       // dPrice/dIV - sensitivity to volatility (per 1% IV move)
  theta: number;      // dPrice/dTime - time decay per day (usually negative)
  charm: number;      // d(delta)/dTime - delta decay rate
  vanna: number;      // d(delta)/dIV - cross-sensitivity of delta to volatility
  speed: number;      // d(gamma)/dSpot - rate of gamma change
}

export interface BinaryPricing {
  price: number;      // Fair value of binary option (0-1)
  d1: number;         // d1 from Black-Scholes
  d2: number;         // d2 from Black-Scholes
  greeks: BinaryGreeks;
}

export interface PricingInputs {
  spot: number;           // Current spot price
  strike: number;         // Strike price
  tte: number;            // Time to expiry in years
  iv: number;             // Implied volatility as decimal (0.65 = 65%)
  riskFreeRate?: number;  // Risk-free rate as decimal (default: 0.04)
  enableCarryCost?: boolean;  // Whether to apply carry cost (default: true)
  isCall?: boolean;       // true for "above" (call), false for "below" (put)
}

/**
 * Standard normal probability density function (PDF)
 * n(x) = exp(-x²/2) / sqrt(2π)
 */
export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal cumulative distribution function (CDF)
 * Uses Abramowitz & Stegun approximation
 * N(x) = probability that Z ≤ x for standard normal Z
 */
export function normalCdf(x: number): number {
  // Handle extreme values
  if (x > 8) return 1;
  if (x < -8) return 0;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Calculate d1 and d2 for Black-Scholes
 */
function calculateD1D2(
  spot: number,
  strike: number,
  tte: number,
  iv: number,
  r: number
): { d1: number; d2: number } {
  const sqrtT = Math.sqrt(tte);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * iv * iv) * tte) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;

  return { d1, d2 };
}

/**
 * Calculate Greeks for a binary (cash-or-nothing) call option
 *
 * Binary call pays $1 if S > K at expiration (YES token for "above" markets)
 * Price = e^(-rT) * N(d2)
 */
export function calculateBinaryCallGreeks(inputs: PricingInputs): BinaryPricing {
  const {
    spot,
    strike,
    tte,
    iv,
    riskFreeRate = 0.04, // 4% Polymarket holding rate (annualized)
    enableCarryCost = true, // Apply carry cost by default
  } = inputs;

  // Adjust risk-free rate based on carry cost flag (user preference: r=0 when disabled)
  const r = enableCarryCost ? riskFreeRate : 0;

  // Handle edge cases
  if (tte <= 0) {
    // Expired - binary payoff
    const price = spot > strike ? 1 : 0;
    return {
      price,
      d1: spot > strike ? Infinity : -Infinity,
      d2: spot > strike ? Infinity : -Infinity,
      greeks: { delta: 0, gamma: 0, vega: 0, theta: 0, charm: 0, vanna: 0, speed: 0 },
    };
  }

  if (iv <= 0) {
    // Zero volatility - deterministic outcome
    const price = spot > strike ? 1 : 0;
    return {
      price,
      d1: spot > strike ? Infinity : -Infinity,
      d2: spot > strike ? Infinity : -Infinity,
      greeks: { delta: 0, gamma: 0, vega: 0, theta: 0, charm: 0, vanna: 0, speed: 0 },
    };
  }

  // r is already defined above based on enableCarryCost
  const sqrtT = Math.sqrt(tte);
  const { d1, d2 } = calculateD1D2(spot, strike, tte, iv, r);

  // Binary call price = e^(-rT) * N(d2)
  const discount = Math.exp(-r * tte);
  const price = discount * normalCdf(d2);

  // PDF values
  const nd1 = normalPdf(d1);
  const nd2 = normalPdf(d2);

  // Delta = e^(-rT) * n(d2) / (S * σ * √T)
  const delta = discount * nd2 / (spot * iv * sqrtT);

  // Gamma = -e^(-rT) * n(d2) * d1 / (S² * σ² * T)
  const gamma = -discount * nd2 * d1 / (spot * spot * iv * iv * tte);

  // Vega = -e^(-rT) * n(d2) * d1 * √T / σ
  // Scaled to 1% IV move (multiply by 0.01)
  const vegaRaw = -discount * nd2 * d1 * sqrtT / iv;
  const vega = vegaRaw * 0.01;

  // Theta = -r * price + e^(-rT) * n(d2) * (r*d2/σ√T - (1 + d1*d2)/(2T*σ√T))
  // Simplified for typical case where r ≈ 0:
  // Theta ≈ n(d2) * (d1/(2T*σ√T)) / 365 (per day)
  const thetaAnnual = discount * nd2 * (
    (r * d2) / (iv * sqrtT) -
    (1 + d1 * d2) / (2 * tte * iv * sqrtT)
  );
  const theta = thetaAnnual / 365; // Per day

  // Charm (delta decay) = d(delta)/dT
  // Charm = -e^(-rT) * n(d2) / (S * σ * √T) * (r - d1/(2T))
  const charmAnnual = -discount * nd2 / (spot * iv * sqrtT) * (r - d1 / (2 * tte));
  const charm = charmAnnual / 365; // Per day

  // Vanna = d(delta)/dσ = d(vega)/dS
  // Vanna = -e^(-rT) * n(d2) * d2 / (S * σ² * √T)
  const vanna = -discount * nd2 * d2 / (spot * iv * iv * sqrtT) * 0.01;

  // Speed = d(gamma)/dS
  const speed = -gamma * (1 + d1 / (iv * sqrtT)) / spot;

  return {
    price,
    d1,
    d2,
    greeks: {
      delta,
      gamma,
      vega,
      theta,
      charm,
      vanna,
      speed,
    },
  };
}

/**
 * Calculate Greeks for a binary (cash-or-nothing) put option
 *
 * Binary put pays $1 if S < K at expiration (NO token for "above" markets, or YES for "below")
 * Price = e^(-rT) * N(-d2) = e^(-rT) * (1 - N(d2))
 */
export function calculateBinaryPutGreeks(inputs: PricingInputs): BinaryPricing {
  const callResult = calculateBinaryCallGreeks(inputs);

  // Binary put price = 1 - Binary call price (put-call parity for binaries)
  const r = (inputs.enableCarryCost !== false) ? (inputs.riskFreeRate || 0.04) : 0;
  const discount = Math.exp(-r * inputs.tte);
  const price = discount - callResult.price;

  // Greeks for put are negatives of call Greeks
  return {
    price,
    d1: callResult.d1,
    d2: callResult.d2,
    greeks: {
      delta: -callResult.greeks.delta,
      gamma: -callResult.greeks.gamma,
      vega: -callResult.greeks.vega,
      theta: -callResult.greeks.theta,
      charm: -callResult.greeks.charm,
      vanna: -callResult.greeks.vanna,
      speed: -callResult.greeks.speed,
    },
  };
}

/**
 * Main entry point - calculate pricing and Greeks for binary option
 */
export function calculateBinaryGreeks(inputs: PricingInputs): BinaryPricing {
  const { isCall = true } = inputs;

  if (isCall) {
    return calculateBinaryCallGreeks(inputs);
  } else {
    return calculateBinaryPutGreeks(inputs);
  }
}

/**
 * Calculate probability of being in-the-money at expiration
 * This is the risk-neutral probability, same as binary call price (when r=0)
 */
export function calculateITMProbability(inputs: Omit<PricingInputs, 'isCall'>): number {
  const { tte, iv } = inputs;

  if (tte <= 0 || iv <= 0) {
    return inputs.spot > inputs.strike ? 1 : 0;
  }

  const { d2 } = calculateD1D2(
    inputs.spot,
    inputs.strike,
    tte,
    iv,
    inputs.riskFreeRate || 0
  );

  return normalCdf(d2);
}

/**
 * Calculate break-even volatility given market price and other inputs
 * Uses Newton-Raphson iteration
 */
export function impliedVolatility(
  spot: number,
  strike: number,
  tte: number,
  marketPrice: number,
  riskFreeRate: number = 0,
  isCall: boolean = true,
  maxIterations: number = 50,
  tolerance: number = 1e-6
): number | null {
  // Initial guess - start with 50% IV
  let iv = 0.5;

  for (let i = 0; i < maxIterations; i++) {
    const result = calculateBinaryGreeks({
      spot,
      strike,
      tte,
      iv,
      riskFreeRate,
      isCall,
    });

    const priceDiff = result.price - marketPrice;

    // Check convergence
    if (Math.abs(priceDiff) < tolerance) {
      return iv;
    }

    // Newton-Raphson: iv_new = iv - f(iv) / f'(iv)
    // f(iv) = modelPrice - marketPrice
    // f'(iv) = vega / 0.01 (since vega is scaled to 1%)
    const vegaUnscaled = result.greeks.vega / 0.01;

    if (Math.abs(vegaUnscaled) < 1e-10) {
      // Vega too small, can't converge
      break;
    }

    iv = iv - priceDiff / vegaUnscaled;

    // Bound IV to reasonable range
    iv = Math.max(0.01, Math.min(5.0, iv));
  }

  return null; // Failed to converge
}

/**
 * Convenience class for working with binary options
 */
export class BinaryOptionCalculator {
  private inputs: PricingInputs;
  private result: BinaryPricing | null = null;

  constructor(inputs: PricingInputs) {
    this.inputs = inputs;
  }

  calculate(): BinaryPricing {
    this.result = calculateBinaryGreeks(this.inputs);
    return this.result;
  }

  get price(): number {
    return (this.result || this.calculate()).price;
  }

  get delta(): number {
    return (this.result || this.calculate()).greeks.delta;
  }

  get gamma(): number {
    return (this.result || this.calculate()).greeks.gamma;
  }

  get vega(): number {
    return (this.result || this.calculate()).greeks.vega;
  }

  get theta(): number {
    return (this.result || this.calculate()).greeks.theta;
  }

  get greeks(): BinaryGreeks {
    return (this.result || this.calculate()).greeks;
  }

  /**
   * Update spot and recalculate
   */
  updateSpot(spot: number): BinaryPricing {
    this.inputs.spot = spot;
    this.result = null;
    return this.calculate();
  }

  /**
   * Update IV and recalculate
   */
  updateIV(iv: number): BinaryPricing {
    this.inputs.iv = iv;
    this.result = null;
    return this.calculate();
  }

  /**
   * Update time to expiry and recalculate
   */
  updateTTE(tte: number): BinaryPricing {
    this.inputs.tte = tte;
    this.result = null;
    return this.calculate();
  }

  /**
   * Get implied volatility from market price
   */
  static impliedVolatility(
    spot: number,
    strike: number,
    tte: number,
    marketPrice: number,
    isCall: boolean = true
  ): number | null {
    return impliedVolatility(spot, strike, tte, marketPrice, 0, isCall);
  }
}
