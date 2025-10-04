import { Module } from "@nestjs/common";
import { PrometheusModule } from "@willsoto/nestjs-prometheus";
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from "@willsoto/nestjs-prometheus";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "src/metrics/metrics.service";

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
    MetricsService,
    makeCounterProvider({
      name: "token_operations_total",
      help: "Total count of token operations by type and status",
      labelNames: ["operation", "status"] as const,
    }),

    makeHistogramProvider({
      name: "token_operations_duration_seconds",
      help: "Duration of token operations in seconds",
      labelNames: ["operation"] as const,
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    }),

    makeGaugeProvider({
      name: "active_tokens_count",
      help: "Current count of active tokens",
    }),

    makeGaugeProvider({
      name: "total_tokens_count",
      help: "Current count of all tokens",
    }),

    makeGaugeProvider({
      name: "unique_devices_count",
      help: "Current count of unique devices",
    }),

    makeCounterProvider({
      name: "token_cleanup_operations_total",
      help: "Total count of token cleanup operations",
      labelNames: ["type"] as const,
    }),

    makeGaugeProvider({
      name: "tokens_cleaned_total",
      help: "Total count of cleaned tokens",
    }),

    makeCounterProvider({
      name: "token_errors_total",
      help: "Total count of errors by type",
      labelNames: ["error_type"] as const,
    }),
  ],
  controllers: [MetricsController],
  exports: [PrometheusModule, MetricsService],
})
export class MetricsModule {}
