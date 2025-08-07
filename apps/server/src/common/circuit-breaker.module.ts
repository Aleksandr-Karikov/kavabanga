import { DynamicModule, Module } from "@nestjs/common";
import { CircuitBreakerManager } from "./circuit-breaker.manager";
import { IErrorClassifier } from "./error-classifier.interface";

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
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
