import { Injectable } from "@nestjs/common";
import { Counter, Histogram, Gauge, register } from "prom-client";

@Injectable()
export class MetricsService {
  constructor() {
    this.initializeMetrics();
  }

  private initializeMetrics() {}

  tokenOperation(operation: string, status: "success" | "error") {
    const counter = register.getSingleMetric(
      "token_operations_total"
    ) as Counter<string>;
    counter.labels({ operation, status }).inc();
  }

  startTimer(operation: string) {
    const histogram = register.getSingleMetric(
      "token_operations_duration_seconds"
    ) as Histogram<string>;
    return histogram.labels({ operation }).startTimer();
  }

  recordTokensCount(active: number, total: number) {
    const activeGauge = register.getSingleMetric(
      "active_tokens_count"
    ) as Gauge<string>;
    const totalGauge = register.getSingleMetric(
      "total_tokens_count"
    ) as Gauge<string>;

    activeGauge.set(active);
    totalGauge.set(total);
  }

  recordError(errorType: string) {
    const counter = register.getSingleMetric(
      "token_errors_total"
    ) as Counter<string>;
    counter.labels({ error_type: errorType }).inc();
  }
}
