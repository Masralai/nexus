export interface Theme {
  bone: string
  boneDim: string
  gold: string
  steel: string
  crimson: string
}

const TRUECOLOR: Theme = {
  bone: "#E6EDF3",
  boneDim: "#9198A1",
  gold: "#58A6FF",
  steel: "#A5D6FF",
  crimson: "#F85149",
}

const ANSI16: Theme = {
  bone: "white",
  boneDim: "gray",
  gold: "cyan",
  steel: "blue",
  crimson: "red",
}

export function theme(
  env: NodeJS.ProcessEnv = process.env,
  stdout: { hasColors?: (count?: number) => boolean } = process.stdout,
): Theme {
  const ct = env.COLORTERM ?? ""
  const truecolor = ct.includes("truecolor") || ct.includes("24bit")
  if (truecolor && stdout.hasColors?.(2 ** 24) !== false) return TRUECOLOR
  return ANSI16
}
