import { Module } from "@nestjs/common";
import { PrometheusModule } from "@willsoto/nestjs-prometheus";
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from "@willsoto/nestjs-prometheus";
import { MetricsController } from "./metrics.controller";

@Module({
  imports: [
    PrometheusModule.register({
      defaultLabels: {
        app: "refresh-token-service",
        // TODO
        // eslint-disable-next-line turbo/no-undeclared-env-vars
        version: process.env.APP_VERSION || "unknown",
      },
    }),
  ],
  providers: [
    makeCounterProvider({
      name: "refresh_token_operations_total",
      help: "Total number of token operations",
      labelNames: ["operation", "status"],
    }),
    makeHistogramProvider({
      name: "refresh_token_operation_duration_seconds",
      help: "Duration of token operations in seconds",
      labelNames: ["operation"],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    }),
    makeGaugeProvider({
      name: "refresh_token_active_total",
      help: "Current number of active refresh tokens",
    }),
    makeCounterProvider({
      name: "refresh_token_cleanup_operations_total",
      help: "Total number of cleanup operations",
      labelNames: ["type"],
    }),
    makeCounterProvider({
      name: "refresh_token_errors_total",
      help: "Total number of errors",
      labelNames: ["error_type"],
    }),
  ],
  controllers: [MetricsController],
  exports: [PrometheusModule],
})
export class MetricsModule {}
