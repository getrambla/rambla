import { nativeWebSocketFactory } from "@getrambla/client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@getrambla/client/internal/daemon-client-transport-types";

export function createAppWebSocketFactory(): WebSocketFactory {
  return nativeWebSocketFactory;
}
