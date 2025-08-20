import { Inject } from "@nestjs/common";
import { TOKEN_REGISTRY_SERVICE } from "./constants";

/**
 * Inject token registry service
 */
export const InjectTokenRegistry = () => Inject(TOKEN_REGISTRY_SERVICE);
