// Number formatting helpers — faithful port of the f0/f1/f2/f4 helpers
// in modules/advisor/biz/market/digest.go. Go's fmt.Sprintf("%.Nf", v)
// rounds half-away-from-zero on .5 ties for typical values; JS's
// toFixed rounds-half-to-even in some engines but in practice matches
// for the price-scale values used here. We mirror the exact Go behavior
// including f4's "return 0 when v == 0".

export function f0(v: number): string {
  return v.toFixed(0)
}

export function f1(v: number): string {
  return v.toFixed(1)
}

export function f2(v: number): string {
  return v.toFixed(2)
}

export function f4(v: number): string {
  if (v === 0) {
    return '0'
  }
  return v.toFixed(4)
}
