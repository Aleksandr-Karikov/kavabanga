import { DynamicModule, Module } from "@nestjs/common";
import { CircuitBreakerManager } from "./circuit-breaker.manager";
import { IErrorClassifier } from "./error-classifier.interface";

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
