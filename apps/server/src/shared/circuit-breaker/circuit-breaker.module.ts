import { DynamicModule, Global, Module } from "@nestjs/common";
import { CircuitBreakerManager } from "./circuit-breaker.manager";
import { IErrorClassifier } from "./error-classifier.interface";

@Global()
@Module({})
export class CircuitBreakerModule {
  static forRoot(errorClassifier: new () => IErrorClassifier): DynamicModule {
    return {
      module: CircuitBreakerModule,
      providers: [
        {
          provide: "IErrorClassifier",
          useClass: errorClassifier,
        },
        CircuitBreakerManager,
      ],
      exports: [CircuitBreakerManager],
    };
  }
}
