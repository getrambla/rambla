import type { RamblaApi } from "@getrambla/client";
import { createContext, useContext, type ReactNode } from "react";

const RamblaApiContext = createContext<RamblaApi | null>(null);

export function useRamblaContextValue(): RamblaApi | null {
  return useContext(RamblaApiContext);
}

export function RamblaApiProvider({ children, rambla }: { children: ReactNode; rambla: RamblaApi }) {
  return <RamblaApiContext.Provider value={rambla}>{children}</RamblaApiContext.Provider>;
}

export function useRambla(): RamblaApi {
  const rambla = useRamblaContextValue();
  if (!rambla) throw new Error("useRambla must run inside a contributed plugin surface");
  return rambla;
}
