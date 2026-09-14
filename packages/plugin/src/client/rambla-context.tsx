import type { RamblaApi } from "@getpaseo/client";
import { createContext, useContext, type ReactNode } from "react";

const RamblaApiContext = createContext<RamblaApi | null>(null);

export function useRamblaContextValue(): RamblaApi | null {
  return useContext(RamblaApiContext);
}

export function RamblaApiProvider({ children, paseo }: { children: ReactNode; paseo: RamblaApi }) {
  return <RamblaApiContext.Provider value={paseo}>{children}</RamblaApiContext.Provider>;
}

export function useRambla(): RamblaApi {
  const paseo = useRamblaContextValue();
  if (!paseo) throw new Error("useRambla must run inside a contributed plugin surface");
  return paseo;
}
