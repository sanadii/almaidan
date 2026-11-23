import type { PaymentGateway } from "./types";
import { TapGateway } from "./tap";
import { MyFatoorahGateway } from "./myfatoorah";
import { MockGateway } from "./mock";
import { assertLiveGatewayConfigured, assertLocalMockRuntime, type Environment } from "../runtime-config";

export * from "./types";

export function getGateway(env: Environment = process.env): PaymentGateway {
  if (env.ENTA_ALLOW_DEV_MOCKS === "true") {
    assertLocalMockRuntime(env);
    return new MockGateway();
  }

  const provider = assertLiveGatewayConfigured(env);
  return provider === "tap" ? new TapGateway() : new MyFatoorahGateway();
}
